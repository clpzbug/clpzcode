/**
 * Memory governor — an always-on, turn-independent heap watchdog.
 *
 * The turn-based eviction in REPL.tsx only fires on isLoading true→false, so a
 * single long turn (a pentest run, or a WorkflowTool fleet executing many tool
 * calls without yielding a turn boundary) can grow the heap to the V8 ceiling
 * and OOM before eviction ever runs. This governor samples heap pressure on a
 * fixed interval — independent of turns — and reclaims proactively so the
 * process stabilizes well below the ceiling instead of climbing into a crash.
 *
 * Pressure is measured as heapUsed / heap_size_limit (the real V8 old-space
 * ceiling set by --max-old-space-size), which is the metric that actually
 * causes OOM — more accurate than system-wide RAM % for predicting a crash.
 *
 * Tiered response (ceiling-relative, so it adapts to whatever heap limit the
 * launcher picked):
 *   - normal   (<60%): nothing
 *   - elevated (>=60%): soft GC, rate-limited
 *   - high     (>=72%): clear UI caches + GC, rate-limited
 *   - critical (>=85%): clear caches + run emergency reclaimers + GC, no limit
 *
 * Reclaimers are registered by the REPL (cache clears, message eviction) so the
 * governor stays a leaf util with no React/REPL imports — no circular deps.
 */

import v8 from 'v8'
import { logForDebugging } from './debug.js'
import { hintGC } from './gc.js'
import { getEffectiveTotalMemBytes, resolveHeapCeilingMb } from './systemMemory.js'

export type MemoryPressure = 'normal' | 'elevated' | 'high' | 'critical'

export type MemorySample = {
  /** V8 heap currently in use, bytes. */
  heapUsed: number
  /** V8 old-space ceiling (reflects --max-old-space-size), bytes. 0 if unknown. */
  heapLimit: number
  /** Resident set size, bytes. */
  rss: number
  /** heapUsed / heapLimit, 0..1 (0 when heapLimit unknown). */
  ratio: number
  /** rss / heapLimit, 0..1 — catches off-heap growth (node-pty/@orama/MCP)
   *  that heapUsed misses. The OOM killer watches RSS, not heapUsed. */
  rssRatio: number
  pressure: MemoryPressure
}

// Pressure thresholds on heapUsed/heapLimit. Ceiling-relative so they hold for
// any --max-old-space-size: at an 11 GB ceiling, critical ~9.4 GB still leaves
// headroom for GC to work before the hard limit.
export const ELEVATED_RATIO = 0.6
export const HIGH_RATIO = 0.72
export const CRITICAL_RATIO = 0.85

const SAMPLE_INTERVAL_MS = 8_000
// Rate limits keep us from GCing every tick. Critical bypasses both.
const ELEVATED_COOLDOWN_MS = 30_000
const HIGH_COOLDOWN_MS = 12_000

type Reclaimer = () => void
type Listener = (sample: MemorySample) => void

// Cheap UI-cache clears (token/highlight caches). Run at high + critical.
const cacheClearers = new Set<Reclaimer>()
// Heavier reclaim (live message-content eviction). Run only at critical.
const emergencyReclaimers = new Set<Reclaimer>()
// Observers (e.g. StatusLine) for the current pressure level.
const listeners = new Set<Listener>()

let timer: ReturnType<typeof setInterval> | null = null
// Per-tier action clocks. A SINGLE shared clock coupled the tiers: a cheap
// `elevated` soft-GC stamped it and then suppressed an urgent `high` reclaim as
// pressure rose. Keep them independent so each tier's cooldown is its own.
let lastElevatedAt = 0
let lastHighAt = 0
let lastSample: MemorySample | null = null

/** Register a cheap cache-clear reclaimer. Returns an unsubscribe fn. */
export function registerCacheClearer(fn: Reclaimer): () => void {
  cacheClearers.add(fn)
  return () => {
    cacheClearers.delete(fn)
  }
}

/** Register a heavy emergency reclaimer (critical tier only). Returns unsubscribe. */
export function registerEmergencyReclaimer(fn: Reclaimer): () => void {
  emergencyReclaimers.add(fn)
  return () => {
    emergencyReclaimers.delete(fn)
  }
}

/** Subscribe to pressure samples (fired once per tick). Returns unsubscribe. */
export function subscribeMemoryPressure(fn: Listener): () => void {
  listeners.add(fn)
  if (lastSample) {
    try {
      fn(lastSample)
    } catch {
      // a faulty listener must not break registration
    }
  }
  return () => {
    listeners.delete(fn)
  }
}

/** Most recent sample, or null before the first tick. */
export function getLastMemorySample(): MemorySample | null {
  return lastSample
}

export function classifyPressure(ratio: number): MemoryPressure {
  if (ratio >= CRITICAL_RATIO) return 'critical'
  if (ratio >= HIGH_RATIO) return 'high'
  if (ratio >= ELEVATED_RATIO) return 'elevated'
  return 'normal'
}

const MB = 1024 * 1024

/**
 * The real old-space ceiling in bytes — the value the launcher passed to
 * --max-old-space-size (bin/clpzcode), recovered from CLPZCODE_HEAP_MB or the
 * shared cgroup-aware sizing in systemMemory.ts.
 *
 * CALIBRATION BUG (was): under Bun, v8.getHeapStatistics().heap_size_limit does
 * NOT reflect --max-old-space-size (Bun ignores the flag and returns its own
 * default), so heapUsed/heap_size_limit was wrong and the governor's tiers
 * never fired at the real ceiling. We prefer the launcher's value and only fall
 * back to V8's number under Node when it looks sane.
 */
function resolveHeapCeilingBytes(): number {
  const overrideMb = parseInt(process.env.CLPZCODE_HEAP_MB || '', 10)
  const launcherMb =
    Number.isFinite(overrideMb) && overrideMb > 0 ? overrideMb : resolveHeapCeilingMb()
  const launcherBytes = launcherMb * MB

  // Under Bun, V8's heap_size_limit is unreliable — trust the launcher value.
  if (typeof Bun !== 'undefined') return launcherBytes

  // Under Node, V8 reflects --max-old-space-size accurately. Use it when sane,
  // otherwise fall back to the launcher value (e.g. headless without the
  // launcher, where the flag may be absent).
  try {
    const v8Limit = v8.getHeapStatistics().heap_size_limit
    if (v8Limit > 0) return v8Limit
  } catch {
    // ignore — fall through to launcher value
  }
  return launcherBytes
}

/** Take a heap-pressure sample. Pure read — no side effects. */
export function sampleMemory(): MemorySample {
  const mu = process.memoryUsage()
  const heapLimit = resolveHeapCeilingBytes()
  const ratio = heapLimit > 0 ? mu.heapUsed / heapLimit : 0
  const rssRatio = heapLimit > 0 ? mu.rss / heapLimit : 0
  // System-memory pressure: rss against EFFECTIVE total RAM (cgroup-aware). The
  // kernel OOM-killer watches RSS vs real RAM, not the V8 ceiling — when off-heap
  // growth or other processes push real free memory low, this catches it even if
  // heap/rss-vs-ceiling still read normal.
  const effectiveTotal = getEffectiveTotalMemBytes()
  const sysRatio = effectiveTotal > 0 ? mu.rss / effectiveTotal : 0
  return {
    heapUsed: mu.heapUsed,
    heapLimit,
    rss: mu.rss,
    ratio,
    rssRatio,
    pressure: classifyPressure(Math.max(ratio, rssRatio, sysRatio)),
  }
}

function runReclaimers(set: Set<Reclaimer>): void {
  for (const fn of set) {
    try {
      fn()
    } catch (err) {
      logForDebugging(`memoryGovernor: reclaimer threw: ${String(err)}`)
    }
  }
}

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024))
}

function notify(sample: MemorySample): void {
  for (const fn of listeners) {
    try {
      fn(sample)
    } catch {
      // listener errors are non-fatal to the governor loop
    }
  }
}

/**
 * Run the reclaim actions appropriate to a sample's pressure tier.
 *  - critical: cache clears + emergency reclaimers + GC, every cycle (no limit)
 *  - high: cache clears + GC, rate-limited by HIGH_COOLDOWN_MS
 *  - elevated: soft GC only, rate-limited by ELEVATED_COOLDOWN_MS
 *  - normal: nothing
 * Separated from runGovernorCycle so tier behavior is testable with synthetic
 * samples (the cycle itself reads real, uncontrollable process memory).
 */
function applyPressureActions(sample: MemorySample, now: number): void {
  switch (sample.pressure) {
    case 'critical':
      runReclaimers(cacheClearers)
      runReclaimers(emergencyReclaimers)
      hintGC()
      lastHighAt = now
      lastElevatedAt = now
      logForDebugging(
        `memoryGovernor CRITICAL heap=${Math.round(sample.ratio * 100)}% ` +
          `rss=${Math.round(sample.rssRatio * 100)}% ` +
          `(heapUsed ${mb(sample.heapUsed)}MB / rss ${mb(sample.rss)}MB / limit ${mb(sample.heapLimit)}MB) — full reclaim`,
      )
      break
    case 'high':
      if (now - lastHighAt >= HIGH_COOLDOWN_MS) {
        runReclaimers(cacheClearers)
        // At high pressure, also evict old message content. Running this earlier
        // (72% vs 85%) gives React time to process the state update and free the
        // memory before the heap climbs further toward the ceiling.
        runReclaimers(emergencyReclaimers)
        hintGC()
        lastHighAt = now
        lastElevatedAt = now
        logForDebugging(
          `memoryGovernor high heap=${Math.round(sample.ratio * 100)}% ` +
            `rss=${Math.round(sample.rssRatio * 100)}% (rss ${mb(sample.rss)}MB) — cache clear + message eviction + GC`,
        )
      }
      break
    case 'elevated':
      if (now - lastElevatedAt >= ELEVATED_COOLDOWN_MS) {
        hintGC()
        lastElevatedAt = now
        logForDebugging(
          `memoryGovernor elevated heap=${Math.round(sample.ratio * 100)}% ` +
            `rss=${Math.round(sample.rssRatio * 100)}% — soft GC`,
        )
      }
      break
    case 'normal':
      break
  }
}

/** One governor cycle: sample, notify, and act per tier. Exported for tests. */
export function runGovernorCycle(now: number = Date.now()): MemorySample {
  const sample = sampleMemory()
  lastSample = sample
  notify(sample)
  applyPressureActions(sample, now)
  return sample
}

/** Start the watchdog. Idempotent. Returns a stop fn. */
export function startMemoryGovernor(): () => void {
  if (timer) return stopMemoryGovernor
  timer = setInterval(() => runGovernorCycle(), SAMPLE_INTERVAL_MS)
  // Never keep the event loop alive solely for the governor.
  ;(timer as unknown as { unref?: () => void }).unref?.()
  return stopMemoryGovernor
}

export function stopMemoryGovernor(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function isMemoryGovernorRunning(): boolean {
  return timer !== null
}

/** Test seam: deterministic cycle + state reset, no real timers. */
export const __test = {
  runGovernorCycle,
  applyPressureActions,
  classifyPressure,
  sampleMemory,
  thresholds: {
    ELEVATED_RATIO,
    HIGH_RATIO,
    CRITICAL_RATIO,
  },
  cooldowns: { ELEVATED_COOLDOWN_MS, HIGH_COOLDOWN_MS },
  counts: () => ({
    cacheClearers: cacheClearers.size,
    emergencyReclaimers: emergencyReclaimers.size,
    listeners: listeners.size,
  }),
  setLastActionAt: (t: number): void => {
    lastElevatedAt = t
    lastHighAt = t
  },
  reset: (): void => {
    stopMemoryGovernor()
    cacheClearers.clear()
    emergencyReclaimers.clear()
    listeners.clear()
    lastElevatedAt = 0
    lastHighAt = 0
    lastSample = null
  },
}
