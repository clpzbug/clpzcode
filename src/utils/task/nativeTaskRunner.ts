import { spawn } from 'child_process'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import type { SetAppState } from '../../Task.js'
import type { AgentId } from '../../types/ids.js'
import type { ExecResult, ShellCommand } from '../ShellCommand.js'
import type { LocalShellTaskState } from '../../tasks/LocalShellTask/guards.js'
import { TaskOutput } from './TaskOutput.js'
import { registerTask } from './framework.js'

export type NativeTaskResult = {
  stdout: string
  stderr: string
  code: number
}

export type NativeTaskOptions = {
  binary: string
  args: string[]
  /** Short label shown in the footer pill and detail dialog */
  description: string
  /** Full command string (binary + args joined) for the detail view */
  command: string
  timeoutMs: number
  setAppState: SetAppState
  agentId?: AgentId
  abortSignal: AbortSignal
  /** Optional environment overrides merged into process.env */
  env?: Record<string, string | undefined>
}

/**
 * Run a native binary with background-task-UI visibility.
 *
 * Registers a running LocalShellTask entry in AppState so the user sees it in
 * the footer pill and can kill it from the task dialog. Returns collected
 * stdout/stderr as strings for the caller to parse after completion.
 *
 * Does NOT background the command — the caller blocks on the returned Promise.
 * The task entry is removed from AppState as soon as the process exits.
 */
export function runNativeWithTask(opts: NativeTaskOptions): Promise<NativeTaskResult> {
  const {
    binary,
    args,
    description,
    command,
    timeoutMs,
    setAppState,
    agentId,
    abortSignal,
    env,
  } = opts

  const taskId = generateTaskId('local_bash')
  const taskOutput = new TaskOutput(taskId, null, false)

  return new Promise<NativeTaskResult>(resolve => {
    const spawnEnv = env
      ? { ...process.env, ...env }
      : process.env
    const proc = spawn(binary, args, { stdio: 'pipe', env: spawnEnv })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let currentStatus: ShellCommand['status'] = 'running'
    let done = false

    const finish = (code: number): void => {
      if (done) return
      done = true
      clearTimeout(timeoutId)
      abortSignal.removeEventListener('abort', abortHandler)
      currentStatus = currentStatus === 'killed' ? 'killed' : 'completed'
      setAppState(prev => {
        const { [taskId]: _removed, ...rest } = prev.tasks
        return { ...prev, tasks: rest }
      })
      taskOutput.clear()
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        code,
      })
    }

    const killProc = (): void => {
      currentStatus = 'killed'
      try { proc.kill('SIGKILL') } catch { /* already dead */ }
    }

    const timeoutId = setTimeout(() => {
      killProc()
      finish(137)
    }, timeoutMs)
    ;(timeoutId as NodeJS.Timeout).unref?.()

    const abortHandler = (): void => {
      killProc()
      finish(137)
    }
    abortSignal.addEventListener('abort', abortHandler, { once: true })

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
      taskOutput.writeStdout(chunk.toString('utf-8'))
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
      taskOutput.writeStderr(chunk.toString('utf-8'))
    })
    proc.once('exit', (code, signal) => {
      finish(code ?? (signal ? 128 : 1))
    })
    proc.once('error', err => {
      taskOutput.writeStderr(err.message)
      finish(1)
    })

    // killTask calls shellCmd.kill() then shellCmd.cleanup() — it does NOT await
    // shellCmd.result. result just needs to satisfy the ShellCommand type.
    const shellCmd: ShellCommand = {
      get status() {
        return currentStatus
      },
      result: Promise.resolve({
        code: 0,
        stdout: '',
        stderr: '',
        interrupted: false,
      } satisfies ExecResult),
      kill() {
        killProc()
        finish(137)
      },
      background() {
        return false
      },
      cleanup() {
        taskOutput.clear()
      },
      taskOutput,
    }

    const taskState: LocalShellTaskState = {
      ...createTaskStateBase(taskId, 'local_bash', description),
      type: 'local_bash',
      status: 'running',
      command,
      completionStatusSentInAttachment: false,
      shellCommand: shellCmd,
      lastReportedTotalLines: 0,
      isBackgrounded: true,
      agentId,
    }
    registerTask(taskState, setAppState)
  })
}
