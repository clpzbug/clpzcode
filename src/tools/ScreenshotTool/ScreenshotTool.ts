import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { DESCRIPTION, SCREENSHOT_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import { captureScreenshot, isChromiumAvailable, type ScreenshotResult } from './utils.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z
      .string()
      .describe(
        'URL to screenshot. Use https://... for web pages or file:///path/to/file.html for local files.',
      ),
    width: z
      .number()
      .int()
      .min(320)
      .max(2560)
      .default(1280)
      .describe('Viewport width in pixels (default: 1280)'),
    height: z
      .number()
      .int()
      .min(240)
      .max(1440)
      .default(800)
      .describe('Viewport height in pixels (default: 800)'),
    full_page: z
      .boolean()
      .default(false)
      .describe('Capture full scrollable page, not just the viewport (default: false)'),
    wait_for: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        'CSS selector to wait for before capturing, or milliseconds to wait (optional)',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string().describe('The URL that was screenshotted'),
    saved_path: z.string().describe('Absolute path where the PNG was saved'),
    bytes: z.number().describe('Size of the PNG in bytes'),
    duration_ms: z.number().describe('Time taken to capture the screenshot'),
    width: z.number().describe('Viewport width used'),
    height: z.number().describe('Viewport height used'),
    full_page: z.boolean().describe('Whether full page was captured'),
    base64: z.string().describe('Base64-encoded PNG data'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const ScreenshotTool = buildTool({
  name: SCREENSHOT_TOOL_NAME,
  searchHint: 'capture screenshot of a URL or local HTML file for visual inspection',
  maxResultSizeChars: 500_000,
  shouldDefer: false,
  isEnabled() {
    return isChromiumAvailable()
  },
  async description(input) {
    const { url } = input as { url: string }
    try {
      const parsed = new URL(url)
      const host = parsed.protocol === 'file:' ? 'local file' : parsed.hostname
      return `Capture screenshot of ${host}`
    } catch {
      return 'Capture screenshot'
    }
  },
  userFacingName() {
    return 'Screenshot'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Screenshotting ${summary}` : 'Capturing screenshot'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.url
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    const { url } = input as { url: string }
    let isLocal = false
    try {
      const parsed = new URL(url)
      isLocal =
        parsed.protocol === 'file:' ||
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname.endsWith('.local')
    } catch {
      // fall through to ask
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
      decisionReason: { type: 'other', reason: 'Screenshot read-only' },
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
        message: `Invalid URL: "${url}". Use https://... or file:///path/to/file.html`,
        meta: { reason: 'invalid_url' },
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call({ url, width, height, full_page, wait_for }, { abortController }) {
    const result = await captureScreenshot(
      { url, width: width ?? 1280, height: height ?? 800, full_page: full_page ?? false, wait_for },
      abortController.signal,
    )
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(result: ScreenshotResult, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: result.base64,
          },
        },
        {
          type: 'text',
          text: `Screenshot captured: ${result.url}\nSaved to: ${result.saved_path}\nSize: ${result.width}×${result.height}, ${result.bytes} bytes, ${result.duration_ms}ms`,
        },
      ],
    }
  },
} satisfies ToolDef<InputSchema, ScreenshotResult>)
