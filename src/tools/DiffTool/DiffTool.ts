import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { DIFF_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const ACTIONS = ['compare', 'timing', 'reflection'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('Target URL with INJECT placeholder for injection point'),
    action: z.enum(ACTIONS).describe('compare=diff payloads vs baseline, timing=time-based detection, reflection=check marker in response'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET').describe('HTTP method'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional request headers'),
    body: z.string().optional().describe('Request body template with INJECT placeholder'),
    inject_header: z.string().optional().describe('Header name to inject payload into (e.g. X-Forwarded-For)'),
    payloads: z.array(z.string()).min(1).max(20).describe('Payloads to test (max 20)'),
    marker: z.string().optional().describe('Unique 8+ char marker for reflection check (e.g. clpzXX7k)'),
    samples: z.number().int().min(1).max(10).default(3).describe('Samples per payload for timing action'),
    timeout_secs: z.number().int().min(5).max(120).default(30).describe('Per-request timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type DiffResult = {
  payload: string
  status_code: number
  status_diff: boolean
  body_size: number
  size_diff: number
  time_ms: number
  time_diff_ms: number
  reflected: boolean
  body_preview: string
  anomaly_score: number
  evidence: string[]
}

export type Output = {
  url: string
  action: string
  baseline_status: number
  baseline_size: number
  baseline_time_ms: number
  results: DiffResult[]
  anomalies: number
  summary: string
  error?: string
}

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string(),
    action: z.string(),
    baseline_status: z.number(),
    baseline_size: z.number(),
    baseline_time_ms: z.number(),
    results: z.array(
      z.object({
        payload: z.string(),
        status_code: z.number(),
        status_diff: z.boolean(),
        body_size: z.number(),
        size_diff: z.number(),
        time_ms: z.number(),
        time_diff_ms: z.number(),
        reflected: z.boolean(),
        body_preview: z.string(),
        anomaly_score: z.number(),
        evidence: z.array(z.string()),
      }),
    ),
    anomalies: z.number(),
    summary: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; body: string; time_ms: number }> {
  const args: string[] = [
    '-s', '-o', '-', '-w', '\n%{http_code}',
    '-X', method,
    '--max-time', String(Math.ceil(timeoutMs / 1000)),
    '--connect-timeout', '5',
    '-k',
  ]

  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`)
  }

  if (body) {
    args.push('--data-binary', body)
  }

  args.push(url)

  const start = Date.now()
  try {
    const { stdout } = await execFileAsync('/usr/sbin/curl', args, {
      timeout: timeoutMs + 5000,
      maxBuffer: 256 * 1024,
      signal,
    })

    const lines = stdout.trim().split('\n')
    const statusStr = lines[lines.length - 1]?.trim() ?? '0'
    const responseBody = lines.slice(0, -1).join('\n')
    const status = !isNaN(parseInt(statusStr, 10)) ? parseInt(statusStr, 10) : 0

    return { status, body: responseBody.substring(0, 2000), time_ms: Date.now() - start }
  } catch {
    return { status: 0, body: '', time_ms: Date.now() - start }
  }
}

function buildRequestParams(
  input: z.infer<InputSchema>,
  payload: string,
): { url: string; headers: Record<string, string>; body: string | undefined } {
  const url = input.url.replace(/INJECT/g, encodeURIComponent(payload))
  const body = input.body?.replace(/INJECT/g, payload)
  const headers: Record<string, string> = { ...(input.headers ?? {}) }
  if (input.inject_header) {
    headers[input.inject_header] = payload
  }
  return { url, headers, body }
}

function buildBaselineParams(
  input: z.infer<InputSchema>,
): { url: string; headers: Record<string, string>; body: string | undefined } {
  const url = input.url.replace(/INJECT/g, '')
  const body = input.body?.replace(/INJECT/g, '')
  const headers: Record<string, string> = { ...(input.headers ?? {}) }
  return { url, headers, body }
}

function computeAnomaly(
  baseline: { status: number; body: string; time_ms: number },
  result: { status: number; body: string; time_ms: number },
  payload: string,
): { score: number; evidence: string[] } {
  const evidence: string[] = []
  let score = 0

  if (result.status !== baseline.status) {
    score += 40
    evidence.push(`Status changed: ${baseline.status} → ${result.status}`)
  }

  const sizeDiff = Math.abs(result.body.length - baseline.body.length)
  if (sizeDiff > 500) {
    score += Math.min(30, Math.floor(sizeDiff / 100))
    evidence.push(`Body size changed by ${sizeDiff > 0 ? '+' : ''}${result.body.length - baseline.body.length}B`)
  } else if (sizeDiff > 100) {
    score += 10
    evidence.push(`Body size changed by ${result.body.length - baseline.body.length}B`)
  }

  const timeDiff = result.time_ms - baseline.time_ms
  if (timeDiff > 5000) {
    score += 30
    evidence.push(`${timeDiff}ms slower than baseline — strong time-based indicator`)
  } else if (timeDiff > 2000) {
    score += 10
    evidence.push(`${timeDiff}ms slower than baseline`)
  }

  const bodyLower = result.body.toLowerCase()
  const errorPats = ['syntax error', 'undefined variable', 'null pointer', 'stack trace', 'exception at', 'fatal error']
  for (const pat of errorPats) {
    if (bodyLower.includes(pat)) {
      score += 15
      evidence.push(`Error pattern in response: "${pat}"`)
      break
    }
  }

  if (payload.length >= 4 && result.body.includes(payload)) {
    score += 20
    evidence.push(`Payload reflected in response body`)
  }

  return { score: Math.min(100, score), evidence }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function runCompare(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const method = input.method ?? 'GET'
  const base = buildBaselineParams(input)
  const baseline = await sendRequest(base.url, method, base.headers, base.body, timeoutMs, signal)

  const results: DiffResult[] = []
  for (const payload of input.payloads) {
    const req = buildRequestParams(input, payload)
    const result = await sendRequest(req.url, method, req.headers, req.body, timeoutMs, signal)
    const reflected = payload.length >= 4 && result.body.includes(payload)
    const { score, evidence } = computeAnomaly(baseline, result, payload)

    results.push({
      payload,
      status_code: result.status,
      status_diff: result.status !== baseline.status,
      body_size: result.body.length,
      size_diff: result.body.length - baseline.body.length,
      time_ms: result.time_ms,
      time_diff_ms: result.time_ms - baseline.time_ms,
      reflected,
      body_preview: result.body.substring(0, 300),
      anomaly_score: score,
      evidence,
    })
  }

  return buildOutput(input, baseline, results)
}

async function runTiming(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const method = input.method ?? 'GET'
  const samples = input.samples ?? 3

  // Collect baseline timing samples
  const base = buildBaselineParams(input)
  const baselineTimes: number[] = []
  let baselineStatus = 0
  let baselineBody = ''
  for (let i = 0; i < samples; i++) {
    const r = await sendRequest(base.url, method, base.headers, base.body, timeoutMs, signal)
    baselineTimes.push(r.time_ms)
    if (i === 0) { baselineStatus = r.status; baselineBody = r.body }
  }
  const baselineMedian = median(baselineTimes)

  const results: DiffResult[] = []
  for (const payload of input.payloads) {
    const req = buildRequestParams(input, payload)
    const payloadTimes: number[] = []
    let lastStatus = 0
    let lastBody = ''
    for (let i = 0; i < samples; i++) {
      const r = await sendRequest(req.url, method, req.headers, req.body, timeoutMs, signal)
      payloadTimes.push(r.time_ms)
      lastStatus = r.status
      lastBody = r.body
    }
    const payloadMedian = median(payloadTimes)
    const timeDiff = payloadMedian - baselineMedian

    const evidence: string[] = []
    let score = 0
    if (timeDiff > 5000) {
      score = 90
      evidence.push(`Median timing ${timeDiff}ms above baseline (${samples} samples) — strong time-based indicator`)
    } else if (timeDiff > 2000) {
      score = 50
      evidence.push(`Median timing ${timeDiff}ms above baseline (${samples} samples)`)
    } else if (timeDiff > 1000) {
      score = 20
      evidence.push(`Median timing ${timeDiff}ms above baseline`)
    } else {
      evidence.push(`Timing delta ${timeDiff}ms — within jitter range`)
    }
    if (lastStatus !== baselineStatus) {
      score += 20
      evidence.push(`Status changed: ${baselineStatus} → ${lastStatus}`)
    }

    results.push({
      payload,
      status_code: lastStatus,
      status_diff: lastStatus !== baselineStatus,
      body_size: lastBody.length,
      size_diff: lastBody.length - baselineBody.length,
      time_ms: payloadMedian,
      time_diff_ms: timeDiff,
      reflected: payload.length >= 4 && lastBody.includes(payload),
      body_preview: lastBody.substring(0, 200),
      anomaly_score: Math.min(100, score),
      evidence,
    })
  }

  return buildOutput(input, { status: baselineStatus, body: baselineBody, time_ms: baselineMedian }, results)
}

async function runReflection(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const method = input.method ?? 'GET'
  const base = buildBaselineParams(input)
  const baseline = await sendRequest(base.url, method, base.headers, base.body, timeoutMs, signal)

  const marker = input.marker ?? input.payloads[0] ?? ''
  const markerInBaseline = baseline.body.includes(marker)

  const results: DiffResult[] = []
  for (const payload of input.payloads) {
    const req = buildRequestParams(input, payload)
    const result = await sendRequest(req.url, method, req.headers, req.body, timeoutMs, signal)
    const reflected = payload.length >= 4 && result.body.includes(payload) && !markerInBaseline

    const evidence: string[] = []
    let score = 0
    if (markerInBaseline) {
      evidence.push(`WARNING: marker "${marker}" already appears in baseline response — choose a different marker`)
    } else if (reflected) {
      score = 80
      evidence.push(`Payload reflected in response body — XSS/SSTI/injection candidate`)
    } else {
      evidence.push(`Payload not reflected`)
    }

    results.push({
      payload,
      status_code: result.status,
      status_diff: result.status !== baseline.status,
      body_size: result.body.length,
      size_diff: result.body.length - baseline.body.length,
      time_ms: result.time_ms,
      time_diff_ms: result.time_ms - baseline.time_ms,
      reflected,
      body_preview: result.body.substring(0, 400),
      anomaly_score: score,
      evidence,
    })
  }

  return buildOutput(input, baseline, results)
}

function buildOutput(
  input: z.infer<InputSchema>,
  baseline: { status: number; body: string; time_ms: number },
  results: DiffResult[],
): Output {
  const anomalies = results.filter(r => r.anomaly_score >= 20).length
  const sorted = [...results].sort((a, b) => b.anomaly_score - a.anomaly_score)
  const top = sorted[0]
  return {
    url: input.url,
    action: input.action,
    baseline_status: baseline.status,
    baseline_size: baseline.body.length,
    baseline_time_ms: baseline.time_ms,
    results,
    anomalies,
    summary: anomalies > 0
      ? `${anomalies}/${results.length} anomalies. Top: "${top?.payload?.substring(0, 50)}" score=${top?.anomaly_score}: ${top?.evidence.join('; ')}`
      : `No anomalies across ${results.length} payload(s)`,
  }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

// ── Test exports ──────────────────────────────────────────────────────────────

export const __test = {
  computeAnomaly,
  buildRequestParams,
  buildBaselineParams,
}

// ── Tool ──────────────────────────────────────────────────────────────────────

export const DiffTool = buildTool({
  name: DIFF_TOOL_NAME,
  maxResultSizeChars: 40_000,
  searchHint: 'diff response compare baseline payload injection blind timing reflection',
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `Diff ${i.action ?? 'compare'}: ${i.url ?? ''} (${i.payloads?.length ?? 0} payloads)`
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
    return i?.action ? `${DIFF_TOOL_NAME}:${i.action}` : DIFF_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `diff ${i?.action ?? 'compare'} ${i?.url ?? ''}`
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
    return `Diff ${i?.action ?? 'compare'}: ${i?.url ?? ''}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `Diff ${i.action ?? 'compare'}: ${i.url ?? ''}`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      const signal = context.abortController.signal
      let result: Output
      switch (input.action) {
        case 'compare':
          result = await runCompare(input, signal)
          break
        case 'timing':
          result = await runTiming(input, signal)
          break
        case 'reflection':
          result = await runReflection(input, signal)
          break
        default:
          result = {
            url: input.url,
            action: input.action,
            baseline_status: 0,
            baseline_size: 0,
            baseline_time_ms: 0,
            results: [],
            anomalies: 0,
            summary: 'Unknown action',
            error: 'Unknown action',
          }
      }
      return { data: result }
    } catch (err: unknown) {
      logForDebugging(`DiffTool error: ${errorMessage(err)}`)
      return {
        data: {
          url: input.url,
          action: input.action,
          baseline_status: 0,
          baseline_size: 0,
          baseline_time_ms: 0,
          results: [],
          anomalies: 0,
          summary: 'Tool execution failed',
          error: errorMessage(err),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    const lines: string[] = [`Diff: ${content.action} → ${content.url}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    lines.push(`Baseline: HTTP ${content.baseline_status}, ${content.baseline_size}B, ${content.baseline_time_ms}ms`)
    lines.push(`Anomalies: ${content.anomalies}/${content.results.length}`)
    lines.push(`Summary: ${content.summary}`)
    lines.push('')

    for (const r of content.results.filter(r => r.anomaly_score >= 20)) {
      lines.push(`Payload: ${r.payload.substring(0, 80)}`)
      lines.push(
        `  Score: ${r.anomaly_score} | HTTP ${r.status_code} | ${r.body_size}B (${r.size_diff >= 0 ? '+' : ''}${r.size_diff}B) | ${r.time_ms}ms (${r.time_diff_ms >= 0 ? '+' : ''}${r.time_diff_ms}ms)`,
      )
      if (r.reflected) lines.push(`  Reflected: YES`)
      for (const e of r.evidence) lines.push(`  ${e}`)
      lines.push(`  Preview: ${r.body_preview.substring(0, 200)}`)
      lines.push('')
    }

    const clean = content.results.filter(r => r.anomaly_score < 20)
    if (clean.length > 0) {
      lines.push(`${clean.length} payload(s): no anomaly (score <20)`)
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
