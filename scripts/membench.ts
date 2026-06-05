#!/usr/bin/env bun
/**
 * membench — repeatable, quantitative memory/perf bench for clpzcode.
 *
 * Produces COMPARABLE numbers across runs so each optimization in
 * docs/MEMORY-AND-RUNTIME-PLAN.md can be validated before/after:
 *
 *   (a) BASELINE  — peak RSS of `--version` (pure bundle parse/compile cost)
 *                   + post-GC residency (rss/heapUsed/external/native) via
 *                     in-process import() + global.gc().
 *   (b) STARTUP   — wall-clock of `--version`, N samples → min/median/mean/max.
 *   (c) GROWTH    — drive an N-turn session, sample the CHILD's VmRSS over
 *                   turns → growth curve. Default driver: PTY interactive
 *                   (key-free, deterministic, exercises the renderer). With
 *                   --headless: `-p` per turn (real LLM turns).
 *   (d) BUNDLE    — dist/cli.mjs (+ .map, + sdk.mjs) byte sizes.
 *
 * CRITICAL (docs/RAM-DEEPDIVE.md §4): measure the CHILD, never the parent
 * launcher. We never go through bin/clpzcode — we spawn `node` DIRECTLY with
 * the SAME V8 flags the launcher would set, so the process we measure IS the
 * child. There is no idle parent to confound RSS.
 *
 * Renderer-agnostic: drives the real built binary (dist/cli.mjs) through a PTY,
 * so it works identically for the current Ink TUI and the future OpenTUI.
 *
 * Read-only against the codebase; writes only under reports/membench/ (gitignored).
 *
 * Usage:
 *   bun run scripts/membench.ts                 # full bench, PTY growth driver
 *   bun run scripts/membench.ts --turns 12      # 12-turn growth session
 *   bun run scripts/membench.ts --headless -p "say ok"   # real LLM-turn growth
 *   bun run scripts/membench.ts --no-build      # skip rebuild, use current dist
 *   bun run scripts/membench.ts --quick         # baseline+startup+bundle only
 *   bun run scripts/membench.ts --out path.json # explicit output path
 *   bun run scripts/membench.ts compare A.json B.json   # diff two reports
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { totalmem } from 'node:os'
import { runGrowthSession, type GrowthSample } from './membench.driver.ts'

// ──────────────────────────────────────────────────────────────────────────
// Paths & constants
// ──────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const DIST_CLI = join(REPO_ROOT, 'dist', 'cli.mjs')
const DIST_CLI_MAP = join(REPO_ROOT, 'dist', 'cli.mjs.map')
const DIST_SDK = join(REPO_ROOT, 'dist', 'sdk.mjs')
const REPORT_DIR = join(REPO_ROOT, 'reports', 'membench')

const MB = 1024 * 1024

/**
 * The exact V8 flags bin/clpzcode:33-46 re-execs the child with. We replicate
 * them so the process we spawn here IS the real operating child — same heap
 * ceiling, same semi-space, --expose-gc available. heapMb mirrors the launcher
 * formula (~70% RAM, clamped [4096,16384]) and is recorded in the report so a
 * different host's numbers are interpretable.
 */
function launcherHeapMb(): number {
  const override = parseInt(process.env.CLPZCODE_HEAP_MB || '', 10)
  if (Number.isFinite(override) && override > 0) return override
  const totalMb = Math.floor(totalmem() / MB)
  return Math.max(4096, Math.min(16384, Math.floor(totalMb * 0.7)))
}

const HEAP_MB = launcherHeapMb()
const CHILD_NODE_FLAGS = [
  `--max-old-space-size=${HEAP_MB}`,
  '--max-semi-space-size=64',
  '--expose-gc',
]
// CLPZCODE_HEAP_SET=1 so that if anything in the app inspects it, it behaves as
// "already respawned" — we never want a nested re-exec under measurement.
const CHILD_ENV = { ...process.env, CLPZCODE_HEAP_SET: '1' }

// ──────────────────────────────────────────────────────────────────────────
// Small utilities
// ──────────────────────────────────────────────────────────────────────────

const mb = (bytes: number): number => Math.round((bytes / MB) * 10) / 10

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0

/** Read VmRSS / VmHWM (peak) of a pid from /proc, in bytes. */
function readProcRss(pid: number): { rss: number; hwm: number } | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const rss = /VmRSS:\s+(\d+)\s+kB/.exec(status)
    const hwm = /VmHWM:\s+(\d+)\s+kB/.exec(status)
    return {
      rss: rss ? parseInt(rss[1]!, 10) * 1024 : 0,
      hwm: hwm ? parseInt(hwm[1]!, 10) * 1024 : 0,
    }
  } catch {
    return null // process exited or no /proc
  }
}

const HAVE_PROC = existsSync('/proc/self/status')

/**
 * Spawn `node <flags> <args>` and resolve with timing, exit code, captured
 * stdout/stderr, and the peak VmHWM observed by polling /proc while alive.
 * Hard timeout → SIGKILL. Guaranteed cleanup via finally.
 */
function runChild(
  args: string[],
  opts: { timeoutMs: number; pollMs?: number; input?: string } = { timeoutMs: 60_000 },
): Promise<{
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  wallMs: number
  peakRssBytes: number
  timedOut: boolean
}> {
  return new Promise(resolvePromise => {
    const t0 = performance.now()
    const child = spawn(process.execPath, [...CHILD_NODE_FLAGS, ...args], {
      cwd: REPO_ROOT,
      env: CHILD_ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let peakRss = 0
    let timedOut = false
    let settled = false

    child.stdout.on('data', d => (stdout += d.toString()))
    child.stderr.on('data', d => (stderr += d.toString()))

    if (opts.input !== undefined) {
      child.stdin.end(opts.input)
    } else {
      child.stdin.end()
    }

    // Poll /proc for the peak even on short-lived processes. Best-effort; if the
    // process dies before the first poll, we fall back to 0 and rely on the
    // post-GC in-process probe for residency.
    const poll = setInterval(() => {
      if (child.pid) {
        const r = readProcRss(child.pid)
        if (r) peakRss = Math.max(peakRss, r.hwm, r.rss)
      }
    }, opts.pollMs ?? 20)
    poll.unref?.()

    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch { /* already dead */ }
    }, opts.timeoutMs)
    timer.unref?.()

    function finish(code: number | null, signal: NodeJS.Signals | null): void {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(timer)
      resolvePromise({
        code,
        signal,
        stdout,
        stderr,
        wallMs: performance.now() - t0,
        peakRssBytes: peakRss,
        timedOut,
      })
    }

    child.on('error', err => {
      stderr += `\n[spawn error] ${(err as Error).message}`
      finish(1, null)
    })
    child.on('exit', (code, signal) => finish(code, signal))
  })
}

// ──────────────────────────────────────────────────────────────────────────
// (d) BUNDLE
// ──────────────────────────────────────────────────────────────────────────

function measureBundle(): {
  cliBytes: number
  cliMapBytes: number
  sdkBytes: number
  cliPath: string
} {
  const safeSize = (p: string): number => {
    try { return statSync(p).size } catch { return 0 }
  }
  return {
    cliBytes: safeSize(DIST_CLI),
    cliMapBytes: safeSize(DIST_CLI_MAP),
    sdkBytes: safeSize(DIST_SDK),
    cliPath: DIST_CLI,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// (b) STARTUP — wall-clock of `--version` (cli.tsx:75-81 zero-import fast path)
// ──────────────────────────────────────────────────────────────────────────

async function measureStartup(samples: number): Promise<{
  samples: number
  minMs: number
  medianMs: number
  meanMs: number
  maxMs: number
  raw: number[]
  versionString: string
}> {
  const times: number[] = []
  let versionString = ''
  // One warmup run (page-cache the 22MB bundle) so we time steady-state, not
  // cold disk. The warmup is discarded.
  await runChild([DIST_CLI, '--version'], { timeoutMs: 30_000 })
  for (let i = 0; i < samples; i++) {
    const r = await runChild([DIST_CLI, '--version'], { timeoutMs: 30_000 })
    if (r.code !== 0) {
      throw new Error(`--version exited ${r.code} (signal ${r.signal}): ${r.stderr.slice(0, 400)}`)
    }
    if (!versionString) versionString = r.stdout.trim()
    times.push(Math.round(r.wallMs * 10) / 10)
  }
  return {
    samples,
    minMs: Math.min(...times),
    medianMs: Math.round(median(times) * 10) / 10,
    meanMs: Math.round(mean(times) * 10) / 10,
    maxMs: Math.max(...times),
    raw: times,
    versionString,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// (a) BASELINE
//   a1: peak RSS of `--version` (pure bundle parse/compile)  [/proc VmHWM]
//   a2: post-GC residency via import() + global.gc()         [in-process probe]
// ──────────────────────────────────────────────────────────────────────────

/**
 * Inline Node probe: import the bundle, force two GCs, print the residency
 * breakdown as a JSON line we parse. Mirrors RAM-DEEPDIVE.md §4 step 2 and the
 * memorySampler.ts native=rss-heapUsed split. We neutralize argv so the CLI
 * takes no destructive action; we only want the module-evaluation + import cost
 * to land in the heap, then we sample & hard-exit so a hung interactive init
 * can never wedge the bench.
 */
const RESIDENCY_PROBE = `
const { pathToFileURL } = require('node:url');
const target = process.env.MEMBENCH_TARGET;
process.argv = [process.argv[0], target];
let done = false;
function report() {
  if (done) return; done = true;
  try { global.gc(); global.gc(); } catch {}
  const m = process.memoryUsage();
  process.stdout.write('MEMBENCH_RESIDENCY ' + JSON.stringify({
    rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal,
    external: m.external, arrayBuffers: m.arrayBuffers, native: m.rss - m.heapUsed,
  }) + '\\n');
  process.exit(0);
}
const ceiling = setTimeout(report, 8000); ceiling.unref && ceiling.unref();
import(pathToFileURL(target).href)
  .then(() => { setTimeout(report, 400); })
  .catch((e) => { process.stderr.write('import-failed: ' + (e && e.message) + '\\n'); report(); });
`

async function measureBaseline(): Promise<{
  versionPeakRssBytes: number
  residency:
    | { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; native: number }
    | null
  residencyOk: boolean
  note: string
}> {
  // a1: peak RSS of the --version fast-path child.
  const ver = await runChild([DIST_CLI, '--version'], { timeoutMs: 30_000, pollMs: 5 })
  const versionPeakRssBytes = ver.peakRssBytes

  // a2: post-GC residency probe (import + gc). Best-effort: importing a CLI
  // bundle headless can be noisy; if it fails we still report a1.
  const probeEnv = { ...CHILD_ENV, MEMBENCH_TARGET: DIST_CLI }
  const res = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>(
    resolveProbe => {
      const child = spawn(process.execPath, [...CHILD_NODE_FLAGS, '-e', RESIDENCY_PROBE], {
        cwd: REPO_ROOT,
        env: probeEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false
      child.stdout.on('data', d => (stdout += d.toString()))
      child.stderr.on('data', d => (stderr += d.toString()))
      const timer = setTimeout(() => {
        timedOut = true
        try { child.kill('SIGKILL') } catch {}
      }, 30_000)
      timer.unref?.()
      const finish = (code: number | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveProbe({ code, stdout, stderr, timedOut })
      }
      child.on('error', e => { stderr += (e as Error).message; finish(1) })
      child.on('exit', code => finish(code))
    },
  )

  let residency: { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; native: number } | null = null
  let residencyOk = false
  let note = ''
  const line = res.stdout.split('\n').find(l => l.startsWith('MEMBENCH_RESIDENCY '))
  if (line) {
    try {
      residency = JSON.parse(line.slice('MEMBENCH_RESIDENCY '.length))
      residencyOk = true
    } catch (e) {
      note = `residency parse failed: ${(e as Error).message}`
    }
  } else {
    note = `residency probe produced no sample (code=${res.code}, timedOut=${res.timedOut}); ${res.stderr.slice(0, 300)}`
  }
  return { versionPeakRssBytes, residency, residencyOk, note }
}

// ──────────────────────────────────────────────────────────────────────────
// (c) GROWTH — delegated to membench.driver.ts (PTY or headless)
// ──────────────────────────────────────────────────────────────────────────

function summarizeGrowth(samples: GrowthSample[]): {
  samples: GrowthSample[]
  firstRssBytes: number
  lastRssBytes: number
  peakRssBytes: number
  growthBytes: number
  perTurnSlopeBytes: number
} {
  if (samples.length === 0) {
    return {
      samples,
      firstRssBytes: 0, lastRssBytes: 0, peakRssBytes: 0,
      growthBytes: 0, perTurnSlopeBytes: 0,
    }
  }
  const rss = samples.map(s => s.rssBytes)
  const first = rss[0]!
  const last = rss[rss.length - 1]!
  const peak = Math.max(...rss)
  // Slope per turn over the captured turn range (simple end-to-end estimate;
  // the full curve is in `samples` for plotting / step detection).
  const turns = samples[samples.length - 1]!.turn - samples[0]!.turn || 1
  return {
    samples,
    firstRssBytes: first,
    lastRssBytes: last,
    peakRssBytes: peak,
    growthBytes: last - first,
    perTurnSlopeBytes: Math.round((last - first) / turns),
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Build (optional)
// ──────────────────────────────────────────────────────────────────────────

function runBuild(): Promise<void> {
  return new Promise((resolveBuild, rejectBuild) => {
    const child = spawn('bun', ['run', 'build'], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
    })
    child.on('error', rejectBuild)
    child.on('exit', code =>
      code === 0 ? resolveBuild() : rejectBuild(new Error(`build exited ${code}`)),
    )
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Report shaping & comparison
// ──────────────────────────────────────────────────────────────────────────

type Report = ReturnType<typeof buildReportShape>

function buildReportShape(parts: {
  baseline: Awaited<ReturnType<typeof measureBaseline>>
  startup: Awaited<ReturnType<typeof measureStartup>>
  growth: ReturnType<typeof summarizeGrowth> | null
  bundle: ReturnType<typeof measureBundle>
  meta: Record<string, unknown>
}) {
  const { baseline, startup, growth, bundle, meta } = parts
  return {
    schema: 'clpzcode.membench/v1',
    meta,
    // (d)
    bundle: {
      cliBytes: bundle.cliBytes,
      cliMB: mb(bundle.cliBytes),
      cliMapBytes: bundle.cliMapBytes,
      cliMapMB: mb(bundle.cliMapBytes),
      sdkBytes: bundle.sdkBytes,
      sdkMB: mb(bundle.sdkBytes),
    },
    // (b)
    startup: {
      versionString: startup.versionString,
      samples: startup.samples,
      minMs: startup.minMs,
      medianMs: startup.medianMs,
      meanMs: startup.meanMs,
      maxMs: startup.maxMs,
      rawMs: startup.raw,
    },
    // (a)
    baseline: {
      versionPeakRssBytes: baseline.versionPeakRssBytes,
      versionPeakRssMB: mb(baseline.versionPeakRssBytes),
      residencyOk: baseline.residencyOk,
      residency: baseline.residency
        ? {
            rssBytes: baseline.residency.rss,
            rssMB: mb(baseline.residency.rss),
            heapUsedBytes: baseline.residency.heapUsed,
            heapUsedMB: mb(baseline.residency.heapUsed),
            externalBytes: baseline.residency.external,
            externalMB: mb(baseline.residency.external),
            nativeBytes: baseline.residency.native,
            nativeMB: mb(baseline.residency.native),
            arrayBuffersBytes: baseline.residency.arrayBuffers,
          }
        : null,
      note: baseline.note,
    },
    // (c)
    growth: growth
      ? {
          driver: (growth.samples[0]?.driver ?? 'pty'),
          procSamplingAvailable: HAVE_PROC,
          firstRssBytes: growth.firstRssBytes,
          firstRssMB: mb(growth.firstRssBytes),
          lastRssBytes: growth.lastRssBytes,
          lastRssMB: mb(growth.lastRssBytes),
          peakRssBytes: growth.peakRssBytes,
          peakRssMB: mb(growth.peakRssBytes),
          growthBytes: growth.growthBytes,
          growthMB: mb(growth.growthBytes),
          perTurnSlopeBytes: growth.perTurnSlopeBytes,
          perTurnSlopeMB: mb(growth.perTurnSlopeBytes),
          curve: growth.samples.map(s => ({
            turn: s.turn,
            atMs: s.atMs,
            rssBytes: s.rssBytes,
            rssMB: mb(s.rssBytes),
          })),
        }
      : null,
  }
}

function printSummary(r: Report): void {
  const L = (s: string): void => { process.stderr.write(s + '\n') }
  L('')
  L('========================================================')
  L(`  membench — ${r.meta.version} @ ${r.meta.startedAt}`)
  L('========================================================')
  L(`  (d) BUNDLE   cli.mjs=${r.bundle.cliMB}MB  sdk.mjs=${r.bundle.sdkMB}MB`)
  L(`  (b) STARTUP  --version  median=${r.startup.medianMs}ms  ` +
    `min=${r.startup.minMs}  max=${r.startup.maxMs}  (n=${r.startup.samples})`)
  L(`  (a) BASELINE --version peakRSS=${r.baseline.versionPeakRssMB}MB`)
  if (r.baseline.residency) {
    L(`               post-GC residency  rss=${r.baseline.residency.rssMB}MB ` +
      `heap=${r.baseline.residency.heapUsedMB}MB ` +
      `native=${r.baseline.residency.nativeMB}MB ` +
      `external=${r.baseline.residency.externalMB}MB`)
  } else {
    L(`               post-GC residency  UNAVAILABLE — ${r.baseline.note}`)
  }
  if (r.growth) {
    L(`  (c) GROWTH   driver=${r.growth.driver}  ` +
      `first=${r.growth.firstRssMB}MB -> last=${r.growth.lastRssMB}MB  ` +
      `peak=${r.growth.peakRssMB}MB  d=${r.growth.growthMB}MB  ` +
      `slope=${r.growth.perTurnSlopeMB}MB/turn  (${r.growth.curve.length} samples)`)
    if (!r.growth.procSamplingAvailable) {
      L(`               (no /proc — VmRSS sampling unavailable on this host)`)
    }
  } else {
    L(`  (c) GROWTH   skipped (--quick)`)
  }
  L('========================================================')
  L('')
}

function compareReports(aPath: string, bPath: string): void {
  const a = JSON.parse(readFileSync(aPath, 'utf8')) as Report
  const b = JSON.parse(readFileSync(bPath, 'utf8')) as Report
  const d = (x: number, y: number): string => {
    const delta = y - x
    const pct = x ? ((delta / x) * 100).toFixed(1) : 'n/a'
    const sign = delta > 0 ? '+' : ''
    return `${sign}${Math.round(delta * 10) / 10} (${sign}${pct}%)`
  }
  const L = (s: string): void => { process.stdout.write(s + '\n') }
  L(`membench compare`)
  L(`  A (before): ${a.meta.version} @ ${a.meta.startedAt}  [${aPath}]`)
  L(`  B (after):  ${b.meta.version} @ ${b.meta.startedAt}  [${bPath}]`)
  L(`  metric                         A          B          delta`)
  L(`  bundle cli.mjs (MB)            ${a.bundle.cliMB}      ${b.bundle.cliMB}      ${d(a.bundle.cliMB, b.bundle.cliMB)}`)
  L(`  startup --version median (ms)  ${a.startup.medianMs}     ${b.startup.medianMs}     ${d(a.startup.medianMs, b.startup.medianMs)}`)
  L(`  baseline --version peak (MB)   ${a.baseline.versionPeakRssMB}    ${b.baseline.versionPeakRssMB}    ${d(a.baseline.versionPeakRssMB, b.baseline.versionPeakRssMB)}`)
  if (a.baseline.residency && b.baseline.residency) {
    L(`  residency rss (MB)             ${a.baseline.residency.rssMB}    ${b.baseline.residency.rssMB}    ${d(a.baseline.residency.rssMB, b.baseline.residency.rssMB)}`)
    L(`  residency heapUsed (MB)        ${a.baseline.residency.heapUsedMB}     ${b.baseline.residency.heapUsedMB}     ${d(a.baseline.residency.heapUsedMB, b.baseline.residency.heapUsedMB)}`)
    L(`  residency external (MB)        ${a.baseline.residency.externalMB}     ${b.baseline.residency.externalMB}     ${d(a.baseline.residency.externalMB, b.baseline.residency.externalMB)}`)
  }
  if (a.growth && b.growth) {
    L(`  growth last rss (MB)           ${a.growth.lastRssMB}    ${b.growth.lastRssMB}    ${d(a.growth.lastRssMB, b.growth.lastRssMB)}`)
    L(`  growth delta over session (MB) ${a.growth.growthMB}     ${b.growth.growthMB}     ${d(a.growth.growthMB, b.growth.growthMB)}`)
    L(`  growth slope (MB/turn)         ${a.growth.perTurnSlopeMB}     ${b.growth.perTurnSlopeMB}     ${d(a.growth.perTurnSlopeMB, b.growth.perTurnSlopeMB)}`)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  mode: 'bench' | 'compare'
  comparePaths?: [string, string]
  turns: number
  startupSamples: number
  build: boolean
  quick: boolean
  headless: boolean
  prompt: string
  out?: string
} {
  const a = argv.slice(2)
  if (a[0] === 'compare') {
    if (!a[1] || !a[2]) {
      throw new Error('usage: membench compare <before.json> <after.json>')
    }
    return {
      mode: 'compare',
      comparePaths: [a[1], a[2]],
      turns: 0, startupSamples: 0, build: false, quick: false, headless: false, prompt: '',
    }
  }
  const get = (flag: string): string | undefined => {
    const i = a.indexOf(flag)
    return i >= 0 ? a[i + 1] : undefined
  }
  const has = (flag: string): boolean => a.includes(flag)
  return {
    mode: 'bench',
    turns: parseInt(get('--turns') ?? '8', 10),
    startupSamples: parseInt(get('--startup-samples') ?? '5', 10),
    build: !has('--no-build'),
    quick: has('--quick'),
    headless: has('--headless'),
    prompt: get('-p') ?? get('--prompt') ?? 'reply with the single word: ok',
    out: get('--out'),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (args.mode === 'compare') {
    compareReports(args.comparePaths![0], args.comparePaths![1])
    return
  }

  const startedAt = new Date().toISOString()

  if (args.build) {
    process.stderr.write('[membench] building (bun run build)…\n')
    await runBuild()
  }
  if (!existsSync(DIST_CLI)) {
    throw new Error(`dist/cli.mjs not found at ${DIST_CLI}. Run without --no-build, or run: bun run build`)
  }

  const bundle = measureBundle()

  process.stderr.write('[membench] (b) startup…\n')
  const startup = await measureStartup(args.startupSamples)

  process.stderr.write('[membench] (a) baseline…\n')
  const baseline = await measureBaseline()

  let growth: ReturnType<typeof summarizeGrowth> | null = null
  if (!args.quick) {
    process.stderr.write(
      `[membench] (c) growth — driver=${args.headless ? 'headless -p' : 'pty'} turns=${args.turns}…\n`,
    )
    const samples = await runGrowthSession({
      cliPath: DIST_CLI,
      nodeFlags: CHILD_NODE_FLAGS,
      env: CHILD_ENV,
      cwd: REPO_ROOT,
      turns: args.turns,
      headless: args.headless,
      prompt: args.prompt,
      readProcRss,
      log: (s: string) => process.stderr.write(`[membench:growth] ${s}\n`),
    })
    growth = summarizeGrowth(samples)
  }

  const version = (() => {
    try { return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version } catch { return 'unknown' }
  })()

  const report = buildReportShape({
    baseline, startup, growth, bundle,
    meta: {
      version,
      startedAt,
      finishedAt: new Date().toISOString(),
      node: process.version,
      heapMb: HEAP_MB,
      childNodeFlags: CHILD_NODE_FLAGS,
      procSamplingAvailable: HAVE_PROC,
      host: process.platform,
      totalMemMB: Math.floor(totalmem() / MB),
      growthDriver: args.quick ? null : (args.headless ? 'headless' : 'pty'),
      turns: args.quick ? 0 : args.turns,
    },
  })

  mkdirSync(REPORT_DIR, { recursive: true })
  const stamp = startedAt.replace(/[:.]/g, '-')
  const outPath = args.out ?? join(REPORT_DIR, `${version}-${stamp}.json`)
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  writeFileSync(join(REPORT_DIR, 'latest.json'), JSON.stringify(report, null, 2))

  printSummary(report)
  process.stderr.write(`[membench] wrote ${outPath}\n`)
  process.stderr.write(`[membench] (also reports/membench/latest.json)\n`)
}

main().catch(err => {
  process.stderr.write(`[membench] FAILED: ${err?.stack ?? err}\n`)
  process.exit(1)
})
