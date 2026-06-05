import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { DESCRIPTION, HTTP_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import { formatBody, makeRequest, type HTTPResponse } from './utils.js'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    method: z
      .enum(HTTP_METHODS)
      .default('GET')
      .describe('HTTP method (default: GET)'),
    url: z.string().url().describe('The URL to request'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe('Request headers as key-value pairs'),
    body: z
      .union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())])
      .optional()
      .describe('Request body — string, JSON object, or array'),
    json: z
      .boolean()
      .optional()
      .describe(
        'Auto-serialize body as JSON and set Content-Type header (default: true for POST/PUT/PATCH)',
      ),
    timeout_ms: z
      .number()
      .int()
      .min(100)
      .max(120000)
      .default(30000)
      .describe('Request timeout in milliseconds (default: 30000)'),
    follow_redirects: z
      .boolean()
      .default(true)
      .describe('Follow HTTP redirects (default: true)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.number().describe('HTTP status code'),
    status_text: z.string().describe('HTTP status text'),
    headers: z.record(z.string(), z.string()).describe('Response headers'),
    body: z.string().describe('Response body (truncated to 50KB)'),
    body_bytes: z.number().describe('Full response body size in bytes'),
    truncated: z.boolean().describe('Whether the body was truncated'),
    duration_ms: z.number().describe('Request duration in milliseconds'),
    url: z.string().describe('Final URL after redirects'),
    redirected: z.boolean().describe('Whether the request was redirected'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const HTTPTool = buildTool({
  name: HTTP_TOOL_NAME,
  searchHint: 'make HTTP requests to APIs and web endpoints',
  maxResultSizeChars: 25_000,
  shouldDefer: false,
  async description(input) {
    const { method = 'GET', url } = input as { method: string; url: string }
    try {
      const { hostname } = new URL(url)
      return `${method} request to ${hostname}`
    } catch {
      return `${method} HTTP request`
    }
  },
  userFacingName() {
    return 'HTTP'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const s = getToolUseSummary(input)
    return s ? `Requesting ${s}` : 'Making HTTP request'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.method ?? 'GET'} ${input.url}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    const { url } = input as { url: string }
    let isLocal = false
    try {
      const parsed = new URL(url)
      isLocal =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname.endsWith('.local')
    } catch {
      // fall through
    }
    if (isLocal) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: { type: 'other', reason: 'Local URL' },
      }
    }
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'HTTP request' },
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  async validateInput(input) {
    const { url } = input
    try {
      new URL(url)
    } catch {
      return {
        result: false,
        message: `Invalid URL: "${url}"`,
        meta: { reason: 'invalid_url' },
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, { abortController }) {
    const result = await makeRequest(
      {
        method: input.method ?? 'GET',
        url: input.url,
        headers: input.headers,
        body: input.body,
        json: input.json,
        timeout_ms: input.timeout_ms,
        follow_redirects: input.follow_redirects,
      },
      abortController.signal,
    )
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(result: HTTPResponse, toolUseID) {
    const contentType = result.headers['content-type']
    const formattedBody = formatBody(result.body, contentType)
    const truncNote = result.truncated
      ? `\n[Body truncated: showing ${result.body.length} of ${result.body_bytes} bytes]`
      : ''

    const text = [
      `HTTP ${result.status} ${result.status_text} (${result.duration_ms}ms)`,
      result.redirected ? `Final URL: ${result.url}` : null,
      '',
      'Response headers:',
      ...Object.entries(result.headers).map(([k, v]) => `  ${k}: ${v}`),
      '',
      'Response body:',
      formattedBody,
      truncNote,
    ]
      .filter(line => line !== null)
      .join('\n')

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: text,
    }
  },
} satisfies ToolDef<InputSchema, HTTPResponse>)
