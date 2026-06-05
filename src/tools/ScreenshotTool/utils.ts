import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const CHROMIUM_PATH = '/usr/sbin/chromium'

export function isChromiumAvailable(): boolean {
  return existsSync(CHROMIUM_PATH)
}

export type ScreenshotOptions = {
  url: string
  width: number
  height: number
  full_page: boolean
  wait_for?: string | number
}

export type ScreenshotResult = {
  saved_path: string
  bytes: number
  duration_ms: number
  width: number
  height: number
  url: string
  full_page: boolean
  base64: string
}

export async function captureScreenshot(
  opts: ScreenshotOptions,
  signal: AbortSignal,
): Promise<ScreenshotResult> {
  const { chromium } = await import('playwright-core')
  const start = Date.now()

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: opts.width, height: opts.height })

    signal.throwIfAborted()

    await page.goto(opts.url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    })

    if (opts.wait_for !== undefined) {
      if (typeof opts.wait_for === 'number') {
        await page.waitForTimeout(opts.wait_for)
      } else {
        await page.waitForSelector(opts.wait_for, { timeout: 10000 })
      }
    }

    signal.throwIfAborted()

    const buf = await page.screenshot({
      type: 'png',
      fullPage: opts.full_page,
    })

    const screenshotDir = join(tmpdir(), 'clpzcode-screenshots')
    await mkdir(screenshotDir, { recursive: true })

    const timestamp = Date.now()
    const safeName = opts.url
      .replace(/^https?:\/\//, '')
      .replace(/^file:\/\//, 'file-')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 60)
    const filename = `${safeName}_${timestamp}.png`
    const savedPath = join(screenshotDir, filename)

    await writeFile(savedPath, buf)

    return {
      saved_path: savedPath,
      bytes: buf.length,
      duration_ms: Date.now() - start,
      width: opts.width,
      height: opts.height,
      url: opts.url,
      full_page: opts.full_page,
      base64: buf.toString('base64'),
    }
  } finally {
    await browser.close()
  }
}
