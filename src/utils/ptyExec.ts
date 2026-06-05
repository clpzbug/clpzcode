import { createRequire } from 'module'
import stripAnsi from 'strip-ansi'
import { generateTaskId } from '../Task.js'
import type { ShellCommand, ExecResult } from './ShellCommand.js'
import { TaskOutput } from './task/TaskOutput.js'

const SIGKILL_CODE = 137

// PTY backend, selected by runtime. node-pty is a Node-ABI native addon and
// captures 0 bytes under Bun (its callback loses output on JavaScriptCore);
// bun-pty is the Bun-native FFI equivalent with an identical spawn surface
// (spawn/onData/onExit/kill). Resolved synchronously on first use via
// createRequire — NOT top-level await, which would make ptyExec an async module
// and propagate up the import graph until it hits a CJS require() boundary and
// throws. The specifier is a variable so neither the Node typecheck nor the
// bundler resolves bun-pty's TS/bun:ffi source; both backends are build
// externals, resolved from node_modules at runtime, and only when PTY is used.
type PtyDisposable = { dispose(): void }
type PtyProc = {
  onData(cb: (data: string) => void): PtyDisposable
  onExit(cb: (e: { exitCode?: number; signal?: number }) => void): PtyDisposable
  kill(signal?: string): void
}
type PtySpawn = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => PtyProc

let cachedPtySpawn: PtySpawn | null = null
function getPtySpawn(): PtySpawn {
  if (cachedPtySpawn) return cachedPtySpawn
  const specifier = typeof Bun !== 'undefined' ? 'bun-pty' : 'node-pty'
  const mod = createRequire(import.meta.url)(specifier) as {
    spawn?: PtySpawn
    default?: { spawn?: PtySpawn }
  }
  const spawn = mod.spawn ?? mod.default?.spawn
  if (!spawn) throw new Error(`pty backend "${specifier}" has no spawn export`)
  cachedPtySpawn = spawn
  return cachedPtySpawn
}

export type PtyOptions = {
  cwd: string
  env: Record<string, string | undefined>
  timeout: number
  /** When true, expose onTimeout so BashTool can background instead of kill on timeout. */
  shouldAutoBackground?: boolean
  onProgress?: (
    lastLines: string,
    allLines: string,
    totalLines: number,
    totalBytes: number,
    isIncomplete: boolean,
  ) => void
  abortSignal: AbortSignal
}

/**
 * Spawn a shell command inside a real PTY so that isatty() returns true.
 * Stdout data is ANSI-stripped before being written to TaskOutput (pipe mode).
 * Sandbox is not supported in PTY mode.
 */
export function spawnWithPty(
  shell: string,
  shellArgs: string[],
  opts: PtyOptions,
): ShellCommand {
  const taskId = generateTaskId('local_bash')
  const taskOutput = new TaskOutput(taskId, opts.onProgress ?? null, false)

  let currentStatus: ShellCommand['status'] = 'running'
  let bgTaskId: string | undefined
  let timedOut = false
  // True only when clpzcode itself sent SIGKILL (via abort signal or .kill()).
  // The inner command can exit with code 137 without us (OOM-killed by OS,
  // external signal) — we must not label those as "user interrupted".
  let killedByUs = false
  let onTimeoutCallback:
    | ((backgroundFn: (taskId: string) => boolean) => void)
    | undefined

  // node-pty requires Record<string, string> — strip undefined values
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(opts.env)) {
    if (v !== undefined) env[k] = v
  }

  const proc = getPtySpawn()(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 220,
    rows: 50,
    cwd: opts.cwd,
    env,
  })

  const dataDisposable = proc.onData((rawData: string) => {
    const stripped = stripAnsi(rawData)
    if (stripped) taskOutput.writeStdout(stripped)
  })

  let exitResolver: ((code: number) => void) | null = null
  const exitPromise = new Promise<number>(resolve => {
    exitResolver = resolve
  })

  const exitDisposable = proc.onExit(({ exitCode, signal }) => {
    const code = exitCode ?? (signal ? 128 + signal : 1)
    const r = exitResolver
    exitResolver = null
    r?.(code)
  })

  function backgroundCommand(taskId: string): boolean {
    if (currentStatus !== 'running') return false
    bgTaskId = taskId
    currentStatus = 'backgrounded'
    clearTimeout(timeoutId)
    taskOutput.spillToDisk()
    return true
  }

  const timeoutId = setTimeout(() => {
    if (currentStatus !== 'running') return
    if (opts.shouldAutoBackground && onTimeoutCallback) {
      onTimeoutCallback(backgroundCommand)
    } else {
      timedOut = true
      try { proc.kill() } catch { /* already dead */ }
    }
  }, opts.timeout)
  ;(timeoutId as NodeJS.Timeout).unref?.()

  const abortHandler = (): void => {
    if (currentStatus === 'running') {
      killedByUs = true
      try { proc.kill('SIGKILL') } catch { /* already dead */ }
    }
  }
  opts.abortSignal.addEventListener('abort', abortHandler, { once: true })

  function doCleanup(): void {
    clearTimeout(timeoutId)
    opts.abortSignal.removeEventListener('abort', abortHandler)
    dataDisposable.dispose()
    exitDisposable.dispose()
  }

  const result: Promise<ExecResult> = exitPromise.then(async code => {
    doCleanup()
    if (currentStatus === 'running' || currentStatus === 'backgrounded') {
      currentStatus = 'completed'
    }
    const stdout = await taskOutput.getStdout()
    return {
      code,
      stdout,
      stderr: timedOut
        ? `PTY command timed out after ${Math.round(opts.timeout / 1000)}s`
        : taskOutput.getStderr(),
      // Only mark interrupted if WE sent SIGKILL. A 137 from the inner command
      // (OOM-kill, external signal) is an abnormal exit but not a user interrupt.
      interrupted: code === SIGKILL_CODE && killedByUs,
      backgroundTaskId: bgTaskId,
    } satisfies ExecResult
  })

  return {
    get status() { return currentStatus },
    result,
    kill() {
      currentStatus = 'killed'
      killedByUs = true
      const r = exitResolver
      exitResolver = null
      try { proc.kill('SIGKILL') } catch { /* already dead */ }
      r?.(SIGKILL_CODE)
    },
    background: backgroundCommand,
    cleanup() {
      opts.abortSignal.removeEventListener('abort', abortHandler)
      taskOutput.clear()
    },
    taskOutput,
    ...(opts.shouldAutoBackground
      ? {
          onTimeout(
            callback: (backgroundFn: (taskId: string) => boolean) => void,
          ): void {
            onTimeoutCallback = callback
          },
        }
      : {}),
  }
}
