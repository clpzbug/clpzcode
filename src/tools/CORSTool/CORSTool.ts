import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { CORS_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const CURL = '/usr/sbin/curl'

const inputSchema = lazySchema(() =>
  z.object({
    url: z.string().describe('Target URL to test'),
    origin: z.string().optional().describe('Origin to inject (for action=test)'),
    action: z.enum(['test', 'scan']).describe('test=single origin, scan=multiple bypass patterns'),
    method: z.enum(['GET', 'POST', 'PUT']).default('GET').describe('HTTP method for actual request'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional request headers'),
    timeout_secs: z.number().int().min(5).max(120).default(30).describe('Timeout per request in seconds'),
  })
)

type InputSchema = ReturnType<typeof inputSchema>

type CORSResult = {
  origin: string
  acao: string | null
  acac: boolean
  acrm: string | null
  acrh: string | null
  status: number
  vulnerable: boolean
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  details: string
}

export type Output = {
  url: string
  results: CORSResult[]
  summary: string
  error?: string
}

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string(),
    results: z.array(
      z.object({
        origin: z.string(),
        acao: z.string().nullable(),
        acac: z.boolean(),
        acrm: z.string().nullable(),
        acrh: z.string().nullable(),
        status: z.number(),
        vulnerable: z.boolean(),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
        details: z.string(),
      })
    ),
    summary: z.string(),
    error: z.string().optional(),
  })
)

type OutputSchema = ReturnType<typeof outputSchema>

function parseHeader(raw: string, name: string): string | null {
  const lower = name.toLowerCase()
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    if (line.slice(0, colon).toLowerCase().trim() === lower) {
      return line.slice(colon + 1).trim()
    }
  }
  return null
}

function parseStatus(raw: string): number {
  const match = raw.match(/^HTTP\/[\d.]+ (\d+)/)
  if (match) {
    const parsed = parseInt(match[1], 10)
    return !isNaN(parsed) ? parsed : 0
  }
  return 0
}

function assessSeverity(
  origin: string,
  acao: string | null,
  acac: boolean
): { vulnerable: boolean; severity: CORSResult['severity']; details: string } {
  if (!acao) {
    return { vulnerable: false, severity: 'info', details: 'No ACAO header in response' }
  }

  const acoLower = acao.trim().toLowerCase()
  const originLower = origin.trim().toLowerCase()

  if (acoLower === '*' && acac) {
    return {
      vulnerable: true,
      severity: 'critical',
      details: 'Wildcard ACAO with ACAC:true — invalid config, credentials would be sent',
    }
  }

  if (acoLower === originLower && acac) {
    return {
      vulnerable: true,
      severity: 'critical',
      details: 'Origin reflected with ACAC:true — credentialed cross-origin reads possible',
    }
  }

  if (acoLower === originLower && !acac) {
    return {
      vulnerable: true,
      severity: 'high',
      details: 'Origin reflected without credentials — cross-origin reads without cookies',
    }
  }

  if (acoLower === 'null') {
    return {
      vulnerable: true,
      severity: 'high',
      details: 'ACAO: null — null origin bypass possible via sandboxed iframe',
    }
  }

  if (acoLower === '*') {
    return {
      vulnerable: false,
      severity: 'info',
      details: 'Wildcard ACAO without credentials — public resource',
    }
  }

  return { vulnerable: false, severity: 'info', details: `ACAO: ${acao} — not reflected` }
}

async function testOrigin(
  url: string,
  origin: string,
  method: string,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CORSResult> {
  const curlArgs = [
    '-s',
    '-i',
    '--max-time',
    String(Math.ceil(timeoutMs / 1000)),
    '-X',
    'OPTIONS',
    '-H',
    `Origin: ${origin}`,
    '-H',
    'Access-Control-Request-Method: GET',
    '-H',
    'Access-Control-Request-Headers: authorization,content-type',
  ]

  for (const [k, v] of Object.entries(extraHeaders)) {
    curlArgs.push('-H', `${k}: ${v}`)
  }
  curlArgs.push(url)

  let preflight = ''
  let status = 0
  try {
    const res = await execFileAsync(CURL, curlArgs, { timeout: timeoutMs + 2000, signal })
    preflight = res.stdout
    status = parseStatus(preflight)
  } catch {
    // preflight failed — try actual request
  }

  // Also try actual GET to see if ACAO is set on non-preflight
  const getArgs = [
    '-s',
    '-i',
    '--max-time',
    String(Math.ceil(timeoutMs / 1000)),
    '-X',
    method,
    '-H',
    `Origin: ${origin}`,
  ]
  for (const [k, v] of Object.entries(extraHeaders)) {
    getArgs.push('-H', `${k}: ${v}`)
  }
  getArgs.push(url)

  let actual = ''
  try {
    const res = await execFileAsync(CURL, getArgs, { timeout: timeoutMs + 2000, signal })
    actual = res.stdout
    if (!status) status = parseStatus(actual)
  } catch {
    // ignore
  }

  const combined = preflight || actual
  const acao = parseHeader(combined, 'access-control-allow-origin')
  const acac = (parseHeader(combined, 'access-control-allow-credentials') ?? '').toLowerCase() === 'true'
  const acrm = parseHeader(combined, 'access-control-allow-methods')
  const acrh = parseHeader(combined, 'access-control-allow-headers')

  const { vulnerable, severity, details } = assessSeverity(origin, acao, acac)

  return { origin, acao, acac, acrm, acrh, status, vulnerable, severity, details }
}

function buildScanOrigins(url: string): string[] {
  let host = ''
  try {
    const parsed = new URL(url)
    host = parsed.hostname
  } catch {
    host = 'target.com'
  }

  const isHttps = url.startsWith('https://')
  return [
    'https://evil.com',
    `https://${host}.evil.com`,
    `https://evil${host}`,
    'null',
    isHttps ? `http://${host}` : `https://${host}`,
    `https://not${host}`,
    `https://${host}evil.com`,
  ]
}

async function runTest(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const method = input.method ?? 'GET'
  const extraHeaders: Record<string, string> = input.headers ?? {}

  if (input.action === 'test') {
    const origin = input.origin ?? 'https://evil.com'
    const result = await testOrigin(input.url, origin, method, extraHeaders, timeoutMs, signal)
    const vuln = result.vulnerable ? `VULNERABLE (${result.severity.toUpperCase()})` : 'Not vulnerable'
    return {
      url: input.url,
      results: [result],
      summary: `${vuln}: ${result.details}`,
    }
  }

  const origins = buildScanOrigins(input.url)
  const results: CORSResult[] = []

  for (const origin of origins) {
    try {
      const r = await testOrigin(input.url, origin, method, extraHeaders, Math.min(timeoutMs, 15_000), signal)
      results.push(r)
    } catch {
      // skip failed origin
    }
  }

  const critical = results.filter(r => r.severity === 'critical')
  const high = results.filter(r => r.severity === 'high')
  const vulnerable = results.filter(r => r.vulnerable)

  let summary: string
  if (critical.length > 0) {
    summary = `CRITICAL: ${critical.length} critical CORS bypass(es) — ${critical.map(r => r.origin).join(', ')}`
  } else if (high.length > 0) {
    summary = `HIGH: ${high.length} high-severity CORS bypass(es) — ${high.map(r => r.origin).join(', ')}`
  } else if (vulnerable.length > 0) {
    summary = `Misconfigured: ${vulnerable.length} issue(s) found`
  } else {
    summary = `No CORS bypass found across ${results.length} origins tested`
  }

  return { url: input.url, results, summary }
}

export const CORSTool = buildTool({
  name: CORS_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'cors — test CORS misconfiguration, origin bypass, credentials, preflight',
  maxResultSizeChars: 30_000,
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
    return i?.action ? `CORS:${i.action}` : 'CORS'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `cors ${i?.action ?? 'scan'} ${i?.url ?? ''}`
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
    return `CORS ${i?.action ?? 'scan'}: ${i?.url ?? ''}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `CORS ${i.action ?? 'scan'}: ${i.url ?? ''}`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      const result = await runTest(input, context.abortController.signal)
      return { data: result }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        data: {
          url: input.url,
          results: [],
          summary: 'Error',
          error: msg,
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: `CORS error: ${content.error}` }
    }

    const lines: string[] = [`CORS Test: ${content.url}`, '', `Summary: ${content.summary}`, '']

    if (content.results.length > 0) {
      lines.push('Results:')
      for (const r of content.results) {
        const flag = r.vulnerable ? `[${r.severity.toUpperCase()}]` : '[info]'
        lines.push(`  ${flag} Origin: ${r.origin}`)
        lines.push(`    ACAO: ${r.acao ?? 'none'} | ACAC: ${r.acac}`)
        lines.push(`    ${r.details}`)
      }
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)

// Exported for testing only
export const __test = { parseHeader, parseStatus, assessSeverity, buildScanOrigins }
