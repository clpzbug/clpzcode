import { CHROMIUM_PATH } from '../ScreenshotTool/utils.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import type { Browser, BrowserContext, Page } from 'playwright-core'

type BrowserSession = {
  browser: Browser
  context: BrowserContext
  page: Page
  lastUsed: number
  stealth: boolean
  proxy?: string
}

let session: BrowserSession | null = null

// The browser is reused across tool calls (fast), but if nothing touches it for
// a while it's just a Chromium process eating CPU/RAM. Auto-close it after an
// idle window so a finished task doesn't leave a browser running for the rest of
// the session. Override the window with CLPZ_BROWSER_IDLE_MS (0 disables).
const IDLE_CLOSE_MS = (() => {
  const v = Number(process.env.CLPZ_BROWSER_IDLE_MS)
  return Number.isFinite(v) && v >= 0 ? v : 180_000
})()
let idleTimer: ReturnType<typeof setTimeout> | null = null
let cleanupRegistered = false

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function armIdleTimer(): void {
  clearIdleTimer()
  if (IDLE_CLOSE_MS <= 0) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    void closeSession()
  }, IDLE_CLOSE_MS)
  // Never keep the process alive just to wait on this timer.
  idleTimer.unref?.()
}

function ensureCleanupRegistered(): void {
  if (cleanupRegistered) return
  cleanupRegistered = true
  // Close the browser on graceful shutdown so it never orphans.
  registerCleanup(() => closeSession())
}

export async function getOrCreateSession(opts?: {
  stealth?: boolean
  proxy?: string
}): Promise<BrowserSession> {
  const wantStealth = opts?.stealth ?? false
  const wantProxy = opts?.proxy

  if (session) {
    const modeMatch = session.stealth === wantStealth && session.proxy === wantProxy
    if (modeMatch) {
      try {
        await session.page.title()
        session.lastUsed = Date.now()
        ensureCleanupRegistered()
        armIdleTimer()
        return session
      } catch {
        session = null
      }
    } else {
      await closeSession()
    }
  }

  let browser: Browser
  let context: BrowserContext

  if (wantStealth) {
    const { launchContext } = await import('cloakbrowser')
    context = await launchContext({
      headless: true,
      ...(wantProxy ? { proxy: { server: wantProxy } } : {}),
    })
    browser = context.browser()!
  } else {
    const { chromium } = await import('playwright-core')
    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    })
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
  }

  const page = await context.newPage()
  session = { browser, context, page, lastUsed: Date.now(), stealth: wantStealth, proxy: wantProxy }
  ensureCleanupRegistered()
  armIdleTimer()
  return session
}

export async function closeSession(): Promise<void> {
  clearIdleTimer()
  if (session) {
    try { await session.context.close() } catch { /* ignore */ }
    try { await session.browser.close() } catch { /* ignore */ }
    session = null
  }
}

export function getSessionInfo(): { active: boolean; url?: string; title?: string } {
  if (!session) return { active: false }
  return { active: true }
}
