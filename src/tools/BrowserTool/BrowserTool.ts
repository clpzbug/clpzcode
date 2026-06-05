import { z } from 'zod/v4'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { isChromiumAvailable } from '../ScreenshotTool/utils.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { DESCRIPTION, BROWSER_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import { closeSession, getOrCreateSession } from './browserSession.js'

export type BrowserOutput = {
  action: string
  url?: string
  title?: string
  saved_path?: string
  bytes?: number
  base64?: string
  result?: unknown
  extracted?: string[]
  message: string
}

const ACTIONS = [
  'navigate', 'click', 'fill', 'select',
  'screenshot', 'evaluate', 'wait', 'extract', 'close',
] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(ACTIONS).describe('Browser action to perform'),
    url: z.string().optional().describe('URL for navigate action'),
    selector: z
      .string()
      .optional()
      .describe('CSS selector for click, fill, wait, extract, select actions'),
    text: z
      .string()
      .optional()
      .describe('Text to type for fill, or option value/label for select'),
    script: z
      .string()
      .optional()
      .describe('JavaScript code to evaluate in the page context'),
    wait_for: z
      .union([z.string(), z.number()])
      .optional()
      .describe('CSS selector or milliseconds to wait after navigate/click'),
    full_page: z
      .boolean()
      .default(false)
      .describe('Capture full page for screenshot (default: false)'),
    timeout_ms: z
      .number()
      .int()
      .min(100)
      .max(60000)
      .default(10000)
      .describe('Max time to wait for elements in milliseconds (default: 10000)'),
    stealth: z
      .boolean()
      .default(false)
      .describe(
        'Use stealth Chromium (CloakBrowser) — bypasses Cloudflare, reCAPTCHA v3, FingerprintJS. Downloads ~200MB binary on first use, cached in ~/.cloakbrowser/',
      ),
    proxy: z
      .string()
      .optional()
      .describe(
        'HTTP/SOCKS proxy URL (e.g. http://user:pass@host:port). Applied to the entire session.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => z.unknown())
type OutputSchema = ReturnType<typeof outputSchema>

async function saveScreenshot(buf: Buffer, label: string): Promise<string> {
  const dir = join(tmpdir(), 'clpzcode-screenshots')
  await mkdir(dir, { recursive: true })
  const name = `browser_${label.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}_${Date.now()}.png`
  const path = join(dir, name)
  await writeFile(path, buf)
  return path
}

export const BrowserTool = buildTool({
  name: BROWSER_TOOL_NAME,
  searchHint:
    'automate a browser: navigate, click, fill forms, screenshot, evaluate JS — persistent session',
  maxResultSizeChars: 100_000,
  shouldDefer: false,
  isEnabled() {
    return isChromiumAvailable()
  },
  async description(input) {
    const { action, url, selector } = input as { action: string; url?: string; selector?: string }
    const detail = url ?? selector ?? ''
    return detail ? `Browser ${action}: ${detail}` : `Browser ${action}`
  },
  userFacingName() {
    return 'Browser'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const s = getToolUseSummary(input)
    return s ? `Browser: ${s}` : 'Browser automation'
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
    return `${input.action} ${input.url ?? input.selector ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Browser automation' },
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  async validateInput(input) {
    if (input.action === 'navigate' && !input.url) {
      return {
        result: false,
        message: '"url" is required for navigate action',
        meta: { reason: 'missing_url' },
        errorCode: 1,
      }
    }
    if (
      ['click', 'fill', 'wait', 'extract', 'select'].includes(input.action) &&
      !input.selector
    ) {
      return {
        result: false,
        message: `"selector" is required for ${input.action} action`,
        meta: { reason: 'missing_selector' },
        errorCode: 1,
      }
    }
    if (input.action === 'fill' && !input.text) {
      return {
        result: false,
        message: '"text" is required for fill action',
        meta: { reason: 'missing_text' },
        errorCode: 1,
      }
    }
    if (input.action === 'evaluate' && !input.script) {
      return {
        result: false,
        message: '"script" is required for evaluate action',
        meta: { reason: 'missing_script' },
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, { abortController }) {
    const { action, url, selector, text, script, wait_for, full_page, timeout_ms = 10000, stealth, proxy } = input

    if (action === 'close') {
      await closeSession()
      return { data: { action: 'close', message: 'Browser session closed' } satisfies BrowserOutput }
    }

    const sess = await getOrCreateSession({ stealth, proxy })
    const { page } = sess

    abortController.signal.throwIfAborted()

    switch (action) {
      case 'navigate': {
        await page.goto(url!, { waitUntil: 'load', timeout: 30000 })
        if (wait_for !== undefined) {
          if (typeof wait_for === 'number') {
            await page.waitForTimeout(wait_for)
          } else {
            await page.waitForSelector(wait_for, { timeout: timeout_ms })
          }
        }
        const title = await page.title()
        const finalUrl = page.url()
        return {
          data: {
            action: 'navigate',
            url: finalUrl,
            title,
            message: `Navigated to ${finalUrl} — "${title}"`,
          } satisfies BrowserOutput,
        }
      }

      case 'click': {
        await page.waitForSelector(selector!, { timeout: timeout_ms })
        await page.click(selector!)
        if (wait_for !== undefined) {
          if (typeof wait_for === 'number') {
            await page.waitForTimeout(wait_for)
          } else {
            await page.waitForSelector(wait_for, { timeout: timeout_ms })
          }
        }
        return {
          data: {
            action: 'click',
            message: `Clicked "${selector}"`,
          } satisfies BrowserOutput,
        }
      }

      case 'fill': {
        await page.waitForSelector(selector!, { timeout: timeout_ms })
        await page.fill(selector!, text!)
        return {
          data: {
            action: 'fill',
            message: `Filled "${selector}" with "${text}"`,
          } satisfies BrowserOutput,
        }
      }

      case 'select': {
        await page.waitForSelector(selector!, { timeout: timeout_ms })
        await page.selectOption(selector!, text ?? '')
        return {
          data: {
            action: 'select',
            message: `Selected "${text}" in "${selector}"`,
          } satisfies BrowserOutput,
        }
      }

      case 'screenshot': {
        const buf = await page.screenshot({ type: 'png', fullPage: full_page ?? false })
        const currentUrl = page.url()
        const savedPath = await saveScreenshot(buf, currentUrl)
        return {
          data: {
            action: 'screenshot',
            url: currentUrl,
            saved_path: savedPath,
            bytes: buf.length,
            base64: buf.toString('base64'),
            message: `Screenshot captured (${buf.length} bytes) → ${savedPath}`,
          } satisfies BrowserOutput,
        }
      }

      case 'evaluate': {
        const evalResult = await page.evaluate(script!)
        return {
          data: {
            action: 'evaluate',
            result: evalResult,
            message: 'JavaScript evaluated successfully',
          } satisfies BrowserOutput,
        }
      }

      case 'wait': {
        if (selector) {
          await page.waitForSelector(selector, { timeout: timeout_ms })
          return {
            data: {
              action: 'wait',
              message: `Element "${selector}" appeared`,
            } satisfies BrowserOutput,
          }
        }
        const waitMs = typeof wait_for === 'number' ? wait_for : timeout_ms
        await page.waitForTimeout(waitMs)
        return {
          data: {
            action: 'wait',
            message: `Waited ${waitMs}ms`,
          } satisfies BrowserOutput,
        }
      }

      case 'extract': {
        await page.waitForSelector(selector!, { timeout: timeout_ms })
        const texts = await page.$$eval(selector!, els =>
          els.map(el => (el as HTMLElement).innerText ?? el.textContent ?? '').filter(Boolean),
        )
        return {
          data: {
            action: 'extract',
            extracted: texts,
            message: `Extracted ${texts.length} element(s) matching "${selector}"`,
          } satisfies BrowserOutput,
        }
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  },
  mapToolResultToToolResultBlockParam(result: BrowserOutput, toolUseID) {
    // Screenshot: return as image block
    if (result.action === 'screenshot' && result.base64) {
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
            text: `Browser screenshot: ${result.url ?? 'current page'}\nSaved to: ${result.saved_path}`,
          },
        ],
      }
    }

    // Extract: return array as text
    if (result.action === 'extract' && result.extracted) {
      const text = result.extracted.join('\n')
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `${result.message}\n\n${text}`,
      }
    }

    // Evaluate: return JS result as JSON
    if (result.action === 'evaluate' && result.result !== undefined) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `${result.message}\nResult: ${JSON.stringify(result.result, null, 2)}`,
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: result.message,
    }
  },
} satisfies ToolDef<InputSchema, BrowserOutput>)
