import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { WEBSOCKET_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const ACTIONS = ['upgrade', 'cswsh', 'auth', 'scan'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('WebSocket URL (wss:// or ws://)'),
    action: z.enum(ACTIONS).describe('upgrade=test WS upgrade, cswsh=CSRF hijack, auth=auth check, scan=all'),
    origin: z.string().optional().describe('Origin header for CSWSH test (default: https://evil.com)'),
    cookie: z.string().optional().describe('Session cookie for authenticated tests'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional headers'),
    timeout_secs: z.number().int().min(5).max(60).default(15).describe('Timeout per probe'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string(),
    action: z.string(),
    probes: z.array(
      z.object({
        test: z.string(),
        status_code: z.number(),
        body_preview: z.string(),
        vulnerable: z.boolean(),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
        evidence: z.string(),
      }),
    ),
    vulnerable: z.boolean(),
    summary: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>
type Probe = Output['probes'][number]

async function sendUpgradeRequest(
  url: string,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')

  const args: string[] = [
    '-s', '-i', '-o', '-',
    '-w', '\n%{http_code}',
    '--http1.1',
    '-H', 'Upgrade: websocket',
    '-H', 'Connection: Upgrade',
    '-H', 'Sec-WebSocket-Version: 13',
    '-H', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    '--max-time', String(Math.floor(timeoutMs / 1000)),
    '--connect-timeout', '5',
    '-k',
  ]

  for (const [k, v] of Object.entries(extraHeaders)) {
    args.push('-H', `${k}: ${v}`)
  }
  args.push(httpUrl)

  try {
    const { stdout } = await execFileAsync('/usr/sbin/curl', args, {
      timeout: timeoutMs + 5000,
      maxBuffer: 64 * 1024,
      signal,
    })

    const lines = stdout.trim().split('\n')
    const rawStatus = lines[lines.length - 1]?.trim() ?? ''
    const statusCode = !isNaN(parseInt(rawStatus, 10)) ? parseInt(rawStatus, 10) : 0
    const body = lines.slice(0, -1).join('\n')
    return { status: statusCode, body: body.substring(0, 500) }
  } catch (err: unknown) {
    return { status: 0, body: `Error: ${errorMessage(err)}` }
  }
}

async function probeUpgrade(url: string, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<Probe> {
  const { status, body } = await sendUpgradeRequest(url, headers, timeoutMs, signal)
  const upgraded = status === 101

  return {
    test: 'ws_upgrade',
    status_code: status,
    body_preview: body.substring(0, 300),
    vulnerable: false,
    severity: 'info',
    evidence: upgraded
      ? `WebSocket upgrade accepted (101 Switching Protocols)`
      : `HTTP ${status} — ${body.toLowerCase().includes('upgrade') ? 'upgrade header present but not 101' : 'WebSocket not supported'}`,
  }
}

async function probeCswsh(url: string, origin: string, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<Probe> {
  const reqHeaders = { ...headers, Origin: origin }
  const { status, body } = await sendUpgradeRequest(url, reqHeaders, timeoutMs, signal)
  const upgraded = status === 101

  return {
    test: `cswsh_origin: ${origin}`,
    status_code: status,
    body_preview: body.substring(0, 300),
    vulnerable: upgraded,
    severity: upgraded ? 'critical' : status === 200 ? 'medium' : 'info',
    evidence: upgraded
      ? `CSWSH VULNERABLE: Foreign origin "${origin}" accepted WS upgrade — session hijacking possible`
      : `HTTP ${status} with foreign origin "${origin}" — origin rejected`,
  }
}

async function probeAuth(url: string, cookie: string | undefined, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<Probe> {
  const noAuthHeaders = { ...headers }
  delete noAuthHeaders['Cookie']
  const { status: statusNoAuth, body: bodyNoAuth } = await sendUpgradeRequest(url, noAuthHeaders, timeoutMs, signal)

  let statusWithAuth = 0
  if (cookie) {
    const { status } = await sendUpgradeRequest(url, { ...headers, Cookie: cookie }, timeoutMs, signal)
    statusWithAuth = status
  }

  const unauthAccepted = statusNoAuth === 101

  return {
    test: 'ws_auth_check',
    status_code: statusNoAuth,
    body_preview: bodyNoAuth.substring(0, 300),
    vulnerable: unauthAccepted,
    severity: unauthAccepted ? 'high' : 'info',
    evidence: unauthAccepted
      ? `WS upgrade accepted without authentication (HTTP 101) — unauthenticated WebSocket access`
      : cookie
        ? `Auth enforced: no-cookie → HTTP ${statusNoAuth}, with-cookie → HTTP ${statusWithAuth}`
        : `No-auth attempt: HTTP ${statusNoAuth}`,
  }
}

async function runWebSocket(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 15) * 1000
  const headers = input.headers ?? {}
  const origin = input.origin ?? 'https://evil.com'
  const probes: Probe[] = []

  const actions: Array<'upgrade' | 'cswsh' | 'auth'> = input.action === 'scan'
    ? ['upgrade', 'cswsh', 'auth']
    : [input.action as 'upgrade' | 'cswsh' | 'auth']

  for (const act of actions) {
    if (act === 'upgrade') probes.push(await probeUpgrade(input.url, headers, timeoutMs, signal))
    else if (act === 'cswsh') probes.push(await probeCswsh(input.url, origin, headers, timeoutMs, signal))
    else if (act === 'auth') probes.push(await probeAuth(input.url, input.cookie, headers, timeoutMs, signal))
  }

  const criticalOrHigh = probes.filter(p => p.vulnerable && (p.severity === 'critical' || p.severity === 'high'))
  const vulnerable = criticalOrHigh.length > 0

  return {
    url: input.url,
    action: input.action,
    probes,
    vulnerable,
    summary: vulnerable
      ? `WebSocket issue FOUND: ${criticalOrHigh[0]?.evidence ?? 'vulnerability detected'}`
      : `No critical WebSocket issues across ${probes.length} probe(s)`,
  }
}

export const WebSocketTool = buildTool({
  name: WEBSOCKET_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'websocket — WebSocket security testing: CSWSH, auth check, upgrade probe',
  maxResultSizeChars: 40_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.action ?? 'scan'}: ${i.url ?? ''}`
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
    return i?.action ? `${WEBSOCKET_TOOL_NAME}:${i.action}` : WEBSOCKET_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `websocket ${i?.action ?? 'scan'} ${i?.url ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `WebSocket ${i?.action ?? 'scan'}: ${i?.url ?? ''}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `WebSocket ${i.action ?? 'scan'}: ${i.url ?? ''}`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      const result = await runWebSocket(input, context.abortController.signal)
      return { data: result }
    } catch (err: unknown) {
      logForDebugging(`WebSocketTool error: ${errorMessage(err)}`, { level: 'error' })
      return {
        data: {
          url: input.url,
          action: input.action,
          probes: [],
          vulnerable: false,
          summary: 'Tool execution failed',
          error: errorMessage(err),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    const lines: string[] = [`WebSocket: ${content.action} → ${content.url}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    lines.push(content.vulnerable ? '⚠ VULNERABLE' : '✓ No critical issues')
    lines.push(`Summary: ${content.summary}`)
    lines.push('')

    for (const p of content.probes) {
      lines.push(`${p.test}: HTTP ${p.status_code} | ${p.severity.toUpperCase()}`)
      lines.push(`  ${p.evidence}`)
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
