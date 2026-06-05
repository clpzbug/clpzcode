import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

export const RECON_TOOL_NAME = 'Recon'

// Endpoint → likely vuln class signal table
const VULN_SIGNALS: Array<{ pattern: RegExp; classes: string[] }> = [
  // SSTI — highest priority because it leads directly to RCE
  { pattern: /\/render|\/template|\/preview|\?template=|\?name=|\?title=|\?message=|\?subject=|\?body=/i, classes: ['ssti'] },
  // SSRF — high priority: cloud metadata, credential theft
  { pattern: /\/webhook|\/callback|\/proxy|\/fetch|\/ping|\?url=|\?link=|\?src=|\?target=|\?redirect=/i, classes: ['ssrf'] },
  // File upload — leads to webshell
  { pattern: /\/upload|\/file|\/import|\/export|\/download|\/avatar|\/attachment|\/image|\/document/i, classes: ['file-upload', 'xxe', 'path-traversal'] },
  // XML endpoints — XXE
  { pattern: /\/xml|\/soap|\.xml|\?format=xml|content-type=xml/i, classes: ['xxe'] },
  // SQL injection — auth and query endpoints
  { pattern: /\/login|\/signin|\/auth(?!o)|\/session/i, classes: ['sqli', 'auth-bypass'] },
  { pattern: /\/search|\?q=|\?query=|\?s=|\?keyword=|\?filter=|\?where=/i, classes: ['sqli', 'ssti'] },
  // OAuth and auth bypass
  { pattern: /\/oauth|\/token|\/sso|\/authorize/i, classes: ['auth-bypass', 'account-takeover'] },
  // Open redirect → OAuth token theft chain
  { pattern: /\/redirect|\?url=|\?goto=|\?next=|\?return=|\?continue=|\?returnUrl=/i, classes: ['open-redirect'] },
  // Admin / internal — access control
  { pattern: /\/admin|\/panel|\/dashboard|\/manage|\/internal|\/staff|\/backoffice|\/debug|\/console/i, classes: ['access-control', 'priv-esc'] },
  // API / object references — IDOR
  { pattern: /\/api\/|\/v\d+\/|\/graphql|\/rest\//i, classes: ['idor', 'mass-assignment', 'auth-bypass'] },
  { pattern: /\?id=|\?user_id=|\?uid=|\?account=|\?order_id=|\?invoice=|\?document_id=/i, classes: ['idor'] },
  // Auth token endpoints
  { pattern: /\/reset|\/forgot|\?token=|\?key=|\?code=|\?verify=/i, classes: ['auth-bypass', 'token-leak'] },
  // Financial / data endpoints
  { pattern: /\/report|\/invoice|\/order|\/payment|\/billing|\/transaction|\/account/i, classes: ['idor', 'financial-impact'] },
  // Deserialization indicators
  { pattern: /\/deserializ|\.ser\b|\.pickle\b|viewstate|\?data=|\?payload=/i, classes: ['deserialization'] },
  // Prototype pollution indicators
  { pattern: /\/merge|\/extend|\/assign|\/update.*object|\/deep.*copy/i, classes: ['prototype-pollution'] },
  // Spring Boot actuator endpoints (heapdump = memory dump, env = secrets, beans = app map)
  { pattern: /\/actuator\/(?:env|heapdump|dump|mappings|trace|configprops|logfile|shutdown)|\/h2-console/i, classes: ['info-disclosure', 'ssrf', 'rce'] },
  // LFI / path traversal indicators
  { pattern: /\/include|\/page=|\?page=|\?path=|\?dir=|\.php\?file=|\?view=/i, classes: ['lfi', 'path-traversal'] },
]

// HTTP header → tech stack fingerprint table
// Knowing the stack guides which exploits to try first (PHP→SSTI ejs, Java→deserialization, .NET→ViewState)
const TECH_SIGS: Array<{ header: string; value: RegExp; tech: string }> = [
  // Server tech (from X-Powered-By)
  { header: 'x-powered-by', value: /php/i, tech: 'PHP' },
  { header: 'x-powered-by', value: /asp\.net/i, tech: 'ASP.NET' },
  { header: 'x-powered-by', value: /express/i, tech: 'Node.js/Express' },
  { header: 'x-powered-by', value: /next\.js/i, tech: 'Next.js' },
  { header: 'x-powered-by', value: /laravel/i, tech: 'Laravel (PHP)' },
  // Server (from Server header)
  { header: 'server', value: /apache/i, tech: 'Apache' },
  { header: 'server', value: /nginx/i, tech: 'Nginx' },
  { header: 'server', value: /iis/i, tech: 'IIS (ASP.NET)' },
  { header: 'server', value: /tomcat/i, tech: 'Tomcat (Java)' },
  { header: 'server', value: /jetty/i, tech: 'Jetty (Java)' },
  { header: 'server', value: /gunicorn/i, tech: 'Gunicorn (Python)' },
  { header: 'server', value: /uvicorn/i, tech: 'Uvicorn (Python/FastAPI)' },
  { header: 'server', value: /caddy/i, tech: 'Caddy' },
  // Session cookies (identify framework)
  { header: 'set-cookie', value: /phpsessid/i, tech: 'PHP' },
  { header: 'set-cookie', value: /jsessionid/i, tech: 'Java/Tomcat' },
  { header: 'set-cookie', value: /asp\.net_sessionid/i, tech: 'ASP.NET' },
  { header: 'set-cookie', value: /laravel_session/i, tech: 'Laravel (PHP)' },
  { header: 'set-cookie', value: /django/i, tech: 'Django (Python)' },
  { header: 'set-cookie', value: /rails/i, tech: 'Ruby on Rails' },
  // CMS and generators
  { header: 'x-generator', value: /wordpress/i, tech: 'WordPress' },
  { header: 'x-generator', value: /drupal/i, tech: 'Drupal' },
  { header: 'x-generator', value: /joomla/i, tech: 'Joomla' },
  // WAF indicators
  { header: 'cf-ray', value: /./, tech: 'Cloudflare WAF' },
  { header: 'x-sucuri-id', value: /./, tech: 'Sucuri WAF' },
  { header: 'x-akamai-transformed', value: /./, tech: 'Akamai WAF' },
  { header: 'x-fw-server', value: /./, tech: 'Fortinet WAF' },
  // Cloud provider
  { header: 'x-amzn-requestid', value: /./, tech: 'AWS' },
  { header: 'x-ms-request-id', value: /./, tech: 'Azure' },
  // Template engine hints (useful for SSTI targeting)
  { header: 'x-powered-by', value: /twig/i, tech: 'Twig (PHP) — SSTI candidate' },
  { header: 'x-powered-by', value: /jinja/i, tech: 'Jinja2 (Python) — SSTI candidate' },
  // API gateways (bypass upstream WAF logic)
  { header: 'server', value: /kong/i, tech: 'Kong API Gateway' },
  { header: 'x-kong-upstream-latency', value: /./, tech: 'Kong API Gateway' },
  // Spring Boot (Java deserialization + actuator endpoints)
  { header: 'x-application-context', value: /./, tech: 'Spring Boot (Java) — check /actuator endpoints' },
  // WAFs to note for evasion
  { header: 'server', value: /bigip/i, tech: 'F5 BigIP WAF' },
  { header: 'x-iinfo', value: /./, tech: 'Imperva/Incapsula WAF' },
]

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['crt_lookup', 'classify_endpoints', 'tech_detect'])
      .describe(
        'crt_lookup=find subdomains via certificate transparency (crt.sh), classify_endpoints=tag endpoints by vuln class for prioritization, tech_detect=fingerprint web stack from HTTP headers',
      ),
    domain: z
      .string()
      .optional()
      .describe('Root domain for crt_lookup (e.g. "example.com")'),
    endpoints: z
      .array(z.string())
      .optional()
      .describe('List of URLs or paths for classify_endpoints'),
    url: z
      .string()
      .optional()
      .describe('Full URL for tech_detect'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    data: z.unknown(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function callInternal(input: z.infer<InputSchema>): Promise<Output> {
  switch (input.action) {
    case 'crt_lookup': {
      if (!input.domain) {
        return { success: false, action: 'crt_lookup', data: null, error: 'domain required' }
      }
      let raw: unknown[]
      try {
        const { signal: crtSignal, cleanup: crtCleanup } = createCombinedAbortSignal(undefined, { timeoutMs: 20_000 })
        const resp = await fetch(`https://crt.sh/?q=%.${input.domain}&output=json`, {
          headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
          signal: crtSignal,
        }).finally(crtCleanup)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        raw = (await resp.json()) as unknown[]
      } catch (err) {
        return { success: false, action: 'crt_lookup', data: null, error: String(err) }
      }
      const seen = new Set<string>()
      const subdomains: string[] = []
      for (const entry of raw) {
        const nameValue = (entry as Record<string, unknown>).name_value
        if (typeof nameValue !== 'string') continue
        for (const name of nameValue.split('\n')) {
          const clean = name.trim().replace(/^\*\./, '').toLowerCase()
          if (clean && clean.endsWith(input.domain) && !seen.has(clean)) {
            seen.add(clean)
            subdomains.push(clean)
          }
        }
      }
      subdomains.sort()
      return {
        success: true,
        action: 'crt_lookup',
        data: { domain: input.domain, count: subdomains.length, subdomains },
      }
    }

    case 'classify_endpoints': {
      if (!input.endpoints?.length) {
        return { success: false, action: 'classify_endpoints', data: null, error: 'endpoints required' }
      }
      const classified = input.endpoints.map(ep => {
        const classes = [...new Set(VULN_SIGNALS.filter(s => s.pattern.test(ep)).flatMap(m => m.classes))]
        return { endpoint: ep, vuln_classes: classes }
      })
      const summary: Record<string, string[]> = {}
      for (const { endpoint, vuln_classes } of classified) {
        for (const cls of vuln_classes) {
          ;(summary[cls] ??= []).push(endpoint)
        }
      }
      const noClass = classified.filter(c => c.vuln_classes.length === 0).length
      return {
        success: true,
        action: 'classify_endpoints',
        data: { total: input.endpoints.length, no_signal: noClass, classified, summary },
      }
    }

    case 'tech_detect': {
      if (!input.url) {
        return { success: false, action: 'tech_detect', data: null, error: 'url required' }
      }
      let headers: Record<string, string>
      let status: number
      let finalUrl: string
      try {
        const { signal: headSignal, cleanup: headCleanup } = createCombinedAbortSignal(undefined, { timeoutMs: 10_000 })
        const resp = await fetch(input.url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: headSignal,
        }).finally(headCleanup)
        status = resp.status
        finalUrl = resp.url
        headers = {}
        resp.headers.forEach((val, key) => {
          headers[key.toLowerCase()] = val
        })
      } catch {
        // HEAD might be blocked — try GET
        try {
          const { signal: getSignal, cleanup: getCleanup } = createCombinedAbortSignal(undefined, { timeoutMs: 10_000 })
          const resp = await fetch(input.url, {
            redirect: 'follow',
            signal: getSignal,
          }).finally(getCleanup)
          status = resp.status
          finalUrl = resp.url
          headers = {}
          resp.headers.forEach((val, key) => {
            headers[key.toLowerCase()] = val
          })
        } catch (err2) {
          return { success: false, action: 'tech_detect', data: null, error: String(err2) }
        }
      }
      const technologies: string[] = []
      for (const sig of TECH_SIGS) {
        const val = headers[sig.header]
        if (val && sig.value.test(val) && !technologies.includes(sig.tech)) {
          technologies.push(sig.tech)
        }
      }
      const relevantKeys = [
        'server', 'x-powered-by', 'cf-ray', 'x-generator',
        'x-frame-options', 'content-security-policy',
        'strict-transport-security', 'x-content-type-options',
        'access-control-allow-origin', 'set-cookie',
      ]
      const relevant: Record<string, string> = {}
      for (const key of relevantKeys) {
        if (headers[key]) relevant[key] = headers[key]
      }
      const missingSecHeaders = ['strict-transport-security', 'x-frame-options', 'x-content-type-options', 'content-security-policy']
        .filter(h => !headers[h])
      return {
        success: true,
        action: 'tech_detect',
        data: { url: finalUrl, status, technologies, headers: relevant, missing_security_headers: missingSecHeaders },
      }
    }
  }
}

export const ReconTool = buildTool({
  name: RECON_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'recon — subdomain discovery via crt.sh certificate transparency, endpoint vuln-class tagging, web tech fingerprinting from HTTP headers',
  maxResultSizeChars: 100_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.action === 'crt_lookup' && i.domain) return `crt.sh: ${i.domain}`
    if (i.action === 'classify_endpoints') return `Classify ${(i.endpoints ?? []).length} endpoints`
    if (i.action === 'tech_detect' && i.url) return `Tech detect: ${i.url}`
    return 'Recon'
  },
  async prompt() {
    return `Recon utilities not covered by NmapTool or FuzzTool:
- crt_lookup: find subdomains via certificate transparency logs (crt.sh). Run before NmapTool to discover all subdomains.
- classify_endpoints: given endpoints from FuzzTool, tag each with likely vuln classes (ssti, ssrf, sqli, file-upload, xxe, idor, open-redirect, lfi, deserialization, prototype-pollution, auth-bypass, access-control, financial-impact) to prioritize testing. SSTI is highest priority — appears at /render, /template, /preview, ?name=, ?title=.
- tech_detect: HEAD request + header analysis to identify server software, framework, WAF, and missing security headers. Fingerprints 30+ technologies including Jinja2/Twig hints (→ SSTI candidate).`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i?.action ? `Recon:${i.action}` : 'Recon'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `recon ${i?.action ?? ''} ${i?.url ?? i?.domain ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  async call(input, _context) {
    const result = await callInternal(input as z.infer<InputSchema>)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(data: Output, toolUseID) {
    if (!data.success) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content: `Recon error (${data.action}): ${data.error}`,
      }
    }
    const d = data.data as Record<string, unknown>
    const lines: string[] = []

    if (data.action === 'crt_lookup') {
      const subs = d.subdomains as string[]
      lines.push(`crt.sh: ${d.count} subdomains for ${d.domain}`)
      lines.push('')
      subs.forEach(s => lines.push(`  ${s}`))
    } else if (data.action === 'classify_endpoints') {
      const classified = d.classified as Array<{ endpoint: string; vuln_classes: string[] }>
      const summary = d.summary as Record<string, string[]>
      lines.push(`Endpoint classification (${d.total} total, ${d.no_signal} no signal):`)
      lines.push('')
      for (const { endpoint, vuln_classes } of classified) {
        if (vuln_classes.length > 0) lines.push(`  ${endpoint}  →  ${vuln_classes.join(', ')}`)
      }
      lines.push('')
      lines.push('By class:')
      for (const [cls, eps] of Object.entries(summary)) {
        lines.push(`  ${cls}: ${(eps as string[]).length}`)
      }
    } else if (data.action === 'tech_detect') {
      lines.push(`Tech detect: ${d.url} [${d.status}]`)
      const techs = d.technologies as string[]
      lines.push(`Technologies: ${techs.length ? techs.join(', ') : 'unknown'}`)
      lines.push('')
      const headers = d.headers as Record<string, string>
      for (const [k, v] of Object.entries(headers)) {
        lines.push(`  ${k}: ${v}`)
      }
      const missing = d.missing_security_headers as string[]
      if (missing.length) {
        lines.push('')
        lines.push(`Missing security headers: ${missing.join(', ')}`)
      }
    }

    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: lines.join('\n') }
  },
  getActivityDescription(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const target = i?.domain ?? i?.url ?? ''
    return i?.action ? `Recon ${i.action}${target ? ': ' + target : ''}` : 'Recon'
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i.action ? `${i.action}${i.domain ? `: ${i.domain}` : i.url ? `: ${i.url}` : ''}` : 'recon'
  },
  renderToolResultMessage,
} satisfies ToolDef<InputSchema, Output>)

// Exported for testing only
export const __test = { VULN_SIGNALS, TECH_SIGS }
