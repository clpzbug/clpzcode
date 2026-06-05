import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { DESCRIPTION, PROCESS_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import {
  appendLog,
  getAllProcesses,
  getAvailablePort,
  getProcess,
  killProcess,
  registerProcess,
  unregisterProcess,
} from './processRegistry.js'

export type ProcessOutput =
  | {
      action: 'start' | 'restart'
      name: string
      pid: number
      port: number | null
      cmd: string
      message: string
    }
  | {
      action: 'stop'
      name: string
      message: string
      pid?: number
      port?: number | null
    }
  | {
      action: 'status'
      processes: Array<{ name: string; pid: number; port: number | null; cmd: string; uptime_s: number }>
    }
  | {
      action: 'logs'
      name: string
      log_lines: number
      logs: string
    }

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['start', 'stop', 'restart', 'status', 'logs'])
      .describe('Action to perform'),
    name: z
      .string()
      .optional()
      .describe('Unique process name (required for start/stop/restart/logs)'),
    cmd: z
      .string()
      .optional()
      .describe('Shell command to run (required for start/restart)'),
    cwd: z
      .string()
      .optional()
      .describe('Working directory for the process (optional)'),
    port: z
      .number()
      .int()
      .min(1024)
      .max(65535)
      .optional()
      .describe('Port hint — tool will use this port if available'),
    log_lines: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('Number of log lines to return for logs action (default: 50)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => z.unknown())
type OutputSchema = ReturnType<typeof outputSchema>

async function startProcess(
  name: string,
  cmd: string,
  cwd: string,
  portHint?: number,
): Promise<ProcessOutput & { action: 'start' | 'restart' }> {
  // Kill existing if any
  const existing = getProcess(name)
  if (existing) {
    await killProcess(name)
  }

  const { execa } = await import('execa')

  const port = portHint ? await getAvailablePort(portHint) : null

  const child = execa('zsh', ['-c', cmd], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(port ? { PORT: String(port) } : {}),
    },
  }) as ReturnType<typeof execa>

  const pid = child.pid ?? 0

  registerProcess({
    name,
    cmd,
    cwd,
    pid,
    port,
    startedAt: Date.now(),
    logLines: [],
    process: child as Parameters<typeof registerProcess>[0]['process'],
  })

  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n')
    for (const line of lines) {
      if (line.trim()) appendLog(name, `[stdout] ${line}`)
    }
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n')
    for (const line of lines) {
      if (line.trim()) appendLog(name, `[stderr] ${line}`)
    }
  })

  child.on('error', (err: Error) => {
    appendLog(name, `[error] Failed to start: ${err.message}`)
    unregisterProcess(name)
  })

  child.on('exit', (code: number | null) => {
    appendLog(name, `[exit] Process exited with code ${code}`)
    unregisterProcess(name)
  })

  // Give the process a moment to start and potentially fail fast
  await new Promise(r => setTimeout(r, 800))

  const proc = getProcess(name)
  const actualPort = proc?.port ?? null

  return {
    action: 'start',
    name,
    pid,
    port: actualPort,
    cmd,
    message: `Process "${name}" started (pid=${pid}${actualPort ? `, port=${actualPort}` : ''})`,
  }
}

export const ProcessTool = buildTool({
  name: PROCESS_TOOL_NAME,
  searchHint: 'manage background processes — start/stop/restart dev servers and daemons',
  maxResultSizeChars: 50_000,
  shouldDefer: false,
  async description(input) {
    const { action, name } = input as { action: string; name?: string }
    return name ? `${action} process "${name}"` : `${action} processes`
  },
  userFacingName() {
    return 'Process'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const s = getToolUseSummary(input)
    return s ? `Managing process: ${s}` : 'Managing processes'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.name ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Process management' },
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  async validateInput(input) {
    const { action, name, cmd } = input
    if ((action === 'start' || action === 'restart') && !cmd) {
      return {
        result: false,
        message: `"cmd" is required for action "${action}"`,
        meta: { reason: 'missing_cmd' },
        errorCode: 1,
      }
    }
    if ((action === 'stop' || action === 'restart' || action === 'logs') && !name) {
      return {
        result: false,
        message: `"name" is required for action "${action}"`,
        meta: { reason: 'missing_name' },
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, _ctx) {
    const { action, name, cmd, cwd, port, log_lines } = input
    const workDir = cwd ?? getCwd()

    switch (action) {
      case 'start': {
        const result = await startProcess(name!, cmd!, workDir, port)
        return { data: result }
      }

      case 'restart': {
        const result = await startProcess(name!, cmd!, workDir, port)
        return { data: { ...result, action: 'restart' as const } }
      }

      case 'stop': {
        const proc = getProcess(name!)
        const pid = proc?.pid
        const procPort = proc?.port
        await killProcess(name!)
        return {
          data: {
            action: 'stop' as const,
            name: name!,
            pid,
            port: procPort,
            message: proc
              ? `Process "${name}" stopped (pid=${pid})`
              : `No process named "${name}" was running`,
          } satisfies ProcessOutput,
        }
      }

      case 'status': {
        const all = getAllProcesses()
        const now = Date.now()
        return {
          data: {
            action: 'status' as const,
            processes: all.map(p => ({
              name: p.name,
              pid: p.pid,
              port: p.port,
              cmd: p.cmd,
              uptime_s: Math.floor((now - p.startedAt) / 1000),
            })),
          } satisfies ProcessOutput,
        }
      }

      case 'logs': {
        const proc = getProcess(name!)
        if (!proc) {
          return {
            data: {
              action: 'logs' as const,
              name: name!,
              log_lines: 0,
              logs: `No process named "${name}" is running.`,
            } satisfies ProcessOutput,
          }
        }
        const lines = proc.logLines.slice(-(log_lines ?? 50))
        return {
          data: {
            action: 'logs' as const,
            name: name!,
            log_lines: lines.length,
            logs: lines.join('\n'),
          } satisfies ProcessOutput,
        }
      }
    }
  },
  mapToolResultToToolResultBlockParam(result: ProcessOutput, toolUseID) {
    let text: string
    if (result.action === 'status') {
      if (result.processes.length === 0) {
        text = 'No managed processes running.'
      } else {
        text = result.processes
          .map(
            p =>
              `● ${p.name}  pid=${p.pid}${p.port ? `  port=${p.port}` : ''}  uptime=${p.uptime_s}s  cmd: ${p.cmd}`,
          )
          .join('\n')
      }
    } else if (result.action === 'logs') {
      text = result.logs || '(no logs yet)'
    } else {
      text = result.message
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: text,
    }
  },
} satisfies ToolDef<InputSchema, ProcessOutput>)
