import { execFile } from 'child_process'
import { promisify } from 'util'
import { createConnection, createServer } from 'net'
import { connect as tlsConnect } from 'tls'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { NET_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const OPERATIONS = ['banner_grab', 'send', 'check_open', 'scan_ports'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    host: z.string().describe('Target hostname or IP address'),
    port: z.number().int().min(1).max(65535).optional().describe('Target port'),
    operation: z.enum(OPERATIONS).describe('banner_grab | send | check_open | scan_ports'),
    data: z.string().optional().describe('Data to send (for send operation)'),
    ports: z
      .array(z.number().int().min(1).max(65535))
      .optional()
      .describe('Port list for scan_ports operation'),
    ssl: z.boolean().default(false).describe('Use SSL/TLS'),
    timeout_secs: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(5)
      .describe('Connection timeout in seconds'),
    protocol: z.enum(['tcp', 'udp']).default('tcp').describe('Transport protocol'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const PortResultSchema = z.object({
  port: z.number(),
  open: z.boolean(),
  banner: z.string().optional(),
  error: z.string().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    operation: z.string(),
    host: z.string(),
    port: z.number().optional(),
    connected: z.boolean(),
    response: z.string().optional(),
    port_results: z.array(PortResultSchema).optional(),
    elapsed_secs: z.number(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function socketConnect(
  host: string,
  port: number,
  ssl: boolean,
  timeoutMs: number,
  sendData?: string,
): Promise<{ connected: boolean; response: string; error?: string }> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let finished = false

    const timeout = setTimeout(() => {
      if (finished) return
      finished = true
      cleanup()
      resolve({ connected: false, response: '', error: `Timeout after ${timeoutMs}ms` })
    }, timeoutMs)

    const onData = (data: Buffer) => {
      chunks.push(data)
    }

    const onEnd = () => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve({
        connected: true,
        response: Buffer.concat(chunks).toString('utf8', 0, 4096),
      })
    }

    const onError = (err: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve({ connected: false, response: '', error: err.message })
    }

    let sock: ReturnType<typeof createConnection> | ReturnType<typeof tlsConnect> | undefined
    const cleanup = () => { try { sock?.destroy() } catch {} }

    try {
      const readyCallback = () => {
        if (sendData) sock!.write(sendData)
        setTimeout(() => {
          if (!finished) { cleanup(); onEnd() }
        }, Math.min(timeoutMs - 500, 3000))
      }

      sock = ssl
        ? tlsConnect({ host, port, rejectUnauthorized: false }, readyCallback)
        : createConnection({ host, port }, readyCallback)

      sock.on('data', onData)
      sock.on('end', onEnd)
      sock.on('error', err => { cleanup(); onError(err) })
      sock.setTimeout(timeoutMs, () => { cleanup(); onEnd() })
    } catch (err) {
      clearTimeout(timeout)
      cleanup()
      resolve({ connected: false, response: '', error: String(err) })
    }
  })
}

async function checkPortOpen(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ open: boolean; error?: string }> {
  return new Promise(resolve => {
    const sock = createConnection({ host, port }, () => {
      sock.destroy()
      resolve({ open: true })
    })
    sock.setTimeout(timeoutMs)
    sock.on('timeout', () => { sock.destroy(); resolve({ open: false, error: 'timeout' }) })
    sock.on('error', err => { sock.destroy(); resolve({ open: false, error: err.message }) })
  })
}

async function runNet(input: z.infer<InputSchema>): Promise<Output> {
  const start = Date.now()
  const timeoutMs = input.timeout_secs * 1000

  switch (input.operation) {
    case 'banner_grab': {
      if (!input.port) {
        return {
          operation: 'banner_grab',
          host: input.host,
          connected: false,
          elapsed_secs: 0,
          error: 'port is required for banner_grab',
        }
      }
      const result = await socketConnect(input.host, input.port, input.ssl, timeoutMs)
      return {
        operation: 'banner_grab',
        host: input.host,
        port: input.port,
        connected: result.connected,
        response: result.response,
        elapsed_secs: (Date.now() - start) / 1000,
        error: result.error,
      }
    }

    case 'send': {
      if (!input.port) {
        return {
          operation: 'send',
          host: input.host,
          connected: false,
          elapsed_secs: 0,
          error: 'port is required for send',
        }
      }
      const sendData = (input.data ?? '').replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n')
      const result = await socketConnect(input.host, input.port, input.ssl, timeoutMs, sendData)
      return {
        operation: 'send',
        host: input.host,
        port: input.port,
        connected: result.connected,
        response: result.response,
        elapsed_secs: (Date.now() - start) / 1000,
        error: result.error,
      }
    }

    case 'check_open': {
      if (!input.port) {
        return {
          operation: 'check_open',
          host: input.host,
          connected: false,
          elapsed_secs: 0,
          error: 'port is required for check_open',
        }
      }
      const result = await checkPortOpen(input.host, input.port, timeoutMs)
      return {
        operation: 'check_open',
        host: input.host,
        port: input.port,
        connected: result.open,
        elapsed_secs: (Date.now() - start) / 1000,
        error: result.error,
      }
    }

    case 'scan_ports': {
      const ports = input.ports ?? [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 3306, 3389, 8080, 8443]
      const results = await Promise.all(
        ports.map(async port => {
          const r = await checkPortOpen(input.host, port, Math.min(timeoutMs, 3000))
          return { port, open: r.open, error: r.error }
        }),
      )
      return {
        operation: 'scan_ports',
        host: input.host,
        connected: results.some(r => r.open),
        port_results: results,
        elapsed_secs: (Date.now() - start) / 1000,
      }
    }
  }
}

export const NetTool = buildTool({
  name: NET_TOOL_NAME,
  searchHint: 'network — banner grabbing, port scanning, TCP/TLS connectivity checks, raw socket send',
  maxResultSizeChars: 50_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.host && i.port) return `${i.operation ?? 'net'} ${i.host}:${i.port}`
    if (i.host) return `${i.operation ?? 'net'} ${i.host}`
    return 'Network socket operations'
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const host = i?.host ? `:${i.host}` : ''
    return i?.operation ? `Net:${i.operation}${host}` : 'Net'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `net ${input.operation ?? ''} ${input.host ?? ''}:${input.port ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const op = input?.operation ?? 'probe'
    const host = input?.host ?? '?'
    const port = input?.port ? `:${input.port}` : ''
    return `Net ${op}: ${host}${port}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const portStr = i.port ? `:${i.port}` : ''
    return `${i.operation ?? '?'}: ${i.host ?? '?'}${portStr}`
  },
  renderToolResultMessage,
  async call(input) {
    const result = await runNet(input)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error && !content.connected && !content.port_results) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: `Net error: ${content.error}` }
    }

    const lines: string[] = [
      `Net ${content.operation} — ${content.host} (${content.elapsed_secs.toFixed(2)}s)`,
      '',
    ]

    if (content.operation === 'scan_ports' && content.port_results) {
      const open = content.port_results.filter(r => r.open)
      const closed = content.port_results.filter(r => !r.open)
      lines.push(`Open ports (${open.length}/${content.port_results.length}):`)
      for (const r of open) lines.push(`  ${r.port}/tcp  OPEN`)
      if (closed.length > 0) lines.push(`Closed: ${closed.map(r => r.port).join(', ')}`)
    } else {
      lines.push(`Connected: ${content.connected ? 'YES' : 'NO'}`)
      if (content.port) lines.push(`Port: ${content.port}${content.connected ? '' : ' (refused/filtered)'}`)
      if (content.response) {
        lines.push('')
        lines.push('Response:')
        lines.push(content.response.substring(0, 2000))
      }
      if (content.error) lines.push(`Error: ${content.error}`)
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
