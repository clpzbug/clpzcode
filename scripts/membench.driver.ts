/**
 * membench.driver — renderer-agnostic session drivers for the GROWTH measurement.
 *
 * Two drivers, both spawning the REAL built binary (dist/cli.mjs) so they work
 * identically for the current Ink TUI and the future OpenTUI (CLPZCODE_RENDERER=opentui):
 *
 *   pty (default):  spawn `node <flags> dist/cli.mjs` inside a node-pty PTY so
 *                   isatty() is true and the interactive TUI mounts. Type N
 *                   scripted lines + Enter, pacing between turns, and sample the
 *                   CHILD's VmRSS from /proc on a fixed cadence → growth curve.
 *                   No network/LLM key required: this exercises the renderer +
 *                   REPL input pipeline deterministically. (Mirrors the node-pty
 *                   usage in src/utils/ptyExec.ts: pty.spawn, onData/onExit
 *                   disposables, proc.kill cleanup.)
 *
 *   headless:       spawn `node <flags> dist/cli.mjs -p "<prompt>"` once PER turn
 *                   (real LLM turns), sampling each child's peak VmRSS. Used when
 *                   a provider/API is configured. Per docs: -p is the headless
 *                   path (src/main.tsx:611).
 *
 * The PTY driver is the one safe to run as an unattended gate (no key, no
 * network). headless yields real per-turn numbers when you have a provider.
 */

import * as pty from 'node-pty'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'

export type GrowthSample = {
  /** Turn index this sample is associated with (0 = pre-first-input). */
  turn: number
  /** ms since session start. */
  atMs: number
  /** Child VmRSS in bytes (from /proc). */
  rssBytes: number
  driver: 'pty' | 'headless'
}

export type GrowthOptions = {
  cliPath: string
  /** V8 flags the launcher uses; we replicate so the measured proc IS the child. */
  nodeFlags: string[]
  env: Record<string, string | undefined>
  cwd: string
  turns: number
  headless: boolean
  prompt: string
  /** /proc VmRSS/VmHWM reader injected from the parent. */
  readProcRss: (pid: number) => { rss: number; hwm: number } | null
  log: (s: string) => void
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** node-pty needs Record<string,string>; drop undefined (as ptyExec.ts does). */
function cleanEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// PTY interactive driver (default, key-free, deterministic)
// ──────────────────────────────────────────────────────────────────────────

export async function runGrowthSession(opts: GrowthOptions): Promise<GrowthSample[]> {
  return opts.headless ? runHeadlessGrowth(opts) : runPtyGrowth(opts)
}

async function runPtyGrowth(opts: GrowthOptions): Promise<GrowthSample[]> {
  const samples: GrowthSample[] = []
  const t0 = performance.now()

  // Deterministic, side-effect-free scripted lines. These exercise input +
  // render + REPL state without requiring an LLM response. /help and /status
  // are local-only and render UI; plain text lines exercise the input editor.
  const scriptFor = (i: number): string => {
    const rotation = ['/help', '/status', `note ${i}: lorem ipsum dolor sit amet`, '/clear']
    return rotation[i % rotation.length]!
  }

  // Spawn the real binary in a PTY so isatty() is true → interactive TUI mounts.
  const proc = pty.spawn(
    process.execPath,
    [...opts.nodeFlags, opts.cliPath],
    {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: opts.cwd,
      env: {
        ...cleanEnv(opts.env),
        // Keep output deterministic & avoid surprise network/update work.
        CI: '1',
        TERM: 'xterm-256color',
        NO_COLOR: '1',
        CLPZCODE_DISABLE_AUTOUPDATER: '1',
      },
    },
  )

  let sawAnyOutput = false
  const dataDisposable = proc.onData(() => { sawAnyOutput = true })

  let exited = false
  let exitInfo: { exitCode: number; signal?: number } | null = null
  const exitDisposable = proc.onExit(e => {
    exited = true
    exitInfo = e
  })

  // Hard wall-clock ceiling for the whole session: kill regardless.
  const SETTLE_MS = 2500          // let the TUI mount & first paint settle
  const PER_TURN_MS = 1200        // pacing between scripted inputs
  const SAMPLE_EVERY_MS = 250     // VmRSS sampling cadence
  const ceilingMs = SETTLE_MS + (opts.turns + 2) * PER_TURN_MS + 5000

  let sampler: ReturnType<typeof setInterval> | null = null
  let killTimer: ReturnType<typeof setTimeout> | null = null
  let currentTurn = 0

  const cleanup = (): void => {
    if (sampler) clearInterval(sampler)
    if (killTimer) clearTimeout(killTimer)
    dataDisposable.dispose()
    exitDisposable.dispose()
    if (!exited) { try { proc.kill() } catch { /* dead */ } }
  }

  try {
    // Periodic VmRSS sampler on the PTY child PID.
    sampler = setInterval(() => {
      if (exited) return
      const r = opts.readProcRss(proc.pid)
      if (r && r.rss > 0) {
        samples.push({ turn: currentTurn, atMs: Math.round(performance.now() - t0), rssBytes: r.rss, driver: 'pty' })
      }
    }, SAMPLE_EVERY_MS)
    sampler.unref?.()

    // Absolute kill ceiling.
    killTimer = setTimeout(() => { if (!exited) { try { proc.kill() } catch {} } }, ceilingMs)
    killTimer.unref?.()

    await sleep(SETTLE_MS)
    if (exited) {
      opts.log(`PTY child exited during settle (code=${exitInfo?.exitCode}); ` +
        `interactive TUI may need a provider/profile. Captured ${samples.length} early samples.`)
      return samples
    }
    if (!sawAnyOutput) {
      opts.log('warning: no PTY output yet after settle — TUI may not have mounted.')
    }

    // Drive N scripted turns.
    for (let i = 0; i < opts.turns; i++) {
      if (exited) break
      currentTurn = i + 1
      const line = scriptFor(i)
      proc.write(line)
      await sleep(60)
      proc.write('\r') // Enter
      await sleep(PER_TURN_MS)
    }

    // Final settle, then graceful quit.
    if (!exited) {
      currentTurn = opts.turns + 1
      await sleep(PER_TURN_MS)
      // Final sample point.
      const r = opts.readProcRss(proc.pid)
      if (r && r.rss > 0) {
        samples.push({ turn: currentTurn, atMs: Math.round(performance.now() - t0), rssBytes: r.rss, driver: 'pty' })
      }
      // Ctrl-C twice / Ctrl-D to ask the TUI to exit cleanly; fall through to kill.
      try { proc.write('\x03'); await sleep(100); proc.write('\x03'); await sleep(100); proc.write('\x04') } catch {}
      await sleep(400)
    }
  } finally {
    cleanup()
  }

  opts.log(`pty session captured ${samples.length} VmRSS samples over ${currentTurn} turns`)
  return samples
}

// ──────────────────────────────────────────────────────────────────────────
// Headless -p driver (opt-in; real LLM turns; needs a provider)
// ──────────────────────────────────────────────────────────────────────────

async function runHeadlessGrowth(opts: GrowthOptions): Promise<GrowthSample[]> {
  const samples: GrowthSample[] = []
  const t0 = performance.now()

  for (let i = 0; i < opts.turns; i++) {
    const turn = i + 1
    const r = await runOneHeadlessTurn(opts, `${opts.prompt} (turn ${turn})`)
    samples.push({
      turn,
      atMs: Math.round(performance.now() - t0),
      rssBytes: r.peakRssBytes,
      driver: 'headless',
    })
    if (r.code !== 0) {
      opts.log(`headless turn ${turn} exited ${r.code} (${r.errSnippet}); ` +
        `stopping headless growth (likely no provider/API key configured).`)
      break
    }
  }
  opts.log(`headless captured ${samples.length} per-turn peak-RSS samples`)
  return samples
}

function runOneHeadlessTurn(
  opts: GrowthOptions,
  prompt: string,
): Promise<{ code: number | null; peakRssBytes: number; errSnippet: string }> {
  return new Promise(resolvePromise => {
    let peak = 0
    let stderr = ''
    let settled = false

    const child = spawn(
      process.execPath,
      [...opts.nodeFlags, opts.cliPath, '-p', prompt, '--output-format', 'text'],
      { cwd: opts.cwd, env: cleanEnv(opts.env), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    child.stderr.on('data', d => (stderr += d.toString()))

    const poll = setInterval(() => {
      if (child.pid) {
        const r = opts.readProcRss(child.pid)
        if (r) peak = Math.max(peak, r.rss, r.hwm)
      }
    }, 50)
    poll.unref?.()

    // Per-turn ceiling: headless turns hit the network; 90s is generous.
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 90_000)
    timer.unref?.()

    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(timer)
      resolvePromise({ code, peakRssBytes: peak, errSnippet: stderr.slice(0, 200) })
    }
    child.on('error', e => { stderr += (e as Error).message; finish(1) })
    child.on('exit', code => finish(code))
  })
}
