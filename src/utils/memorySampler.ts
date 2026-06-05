/**
 * Memory sampler — P0 instrumentation to discriminate V8-heap OOM vs native/RSS OOM.
 *
 * The memory governor (memoryGovernor.ts) already samples heapUsed/heapLimit per
 * tick to drive reclamation, but it discards rss/external/arrayBuffers and never
 * tracks them over time. When the process OOMs at ~11 GB we cannot tell whether
 * the growth is in the V8 heap (captured by a heap snapshot) or in native memory
 * (node-pty / sharp / Buffers — invisible to the snapshot). This module fills
 * that gap WITHOUT introducing a second clock or touching compiled code:
 *
 *   - It subscribes to the governor's existing pressure stream (subscribeMemoryPressure),
 *     so it samples on the governor's 8 s tick. No new setInterval.
 *   - Every SAMPLE_EVERY_N_TICKS it logs a structured one-liner with the full
 *     memoryUsage() breakdown plus cumulative deltas. The native = rss - heapUsed
 *     split is the discriminator: if native dominates the growth, the snapshot
 *     will look small while RSS is huge → native leak.
 *   - When rss crosses RSS_DUMP_THRESHOLD_BYTES (default ~9 GB, well below the
 *     11 GB OOM point) it fires ONE auto heap snapshot via performHeapDump, with
 *     a per-session dump cap and cooldown so the dump itself never triggers the OOM.
 *
 * Leaf module: no React, no REPL, no governor-internal imports beyond the public
 * subscribe API. Start it once from the same REPL effect that starts the governor.
 */

import { totalmem } from 'os'
import { logForDebugging } from './debug.js'
import { performHeapDump } from './heapDumpService.js'
import { subscribeMemoryPressure } from './memoryGovernor.js'

/** One full memoryUsage() reading plus a timestamp, in bytes. */
export type MemorySnapshot = {
  at: number
  rss: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  /** rss - heapUsed: memory outside the V8 heap (native addons, Buffers, stacks). */
  native: number
}

export type MemorySamplerOptions = {
  /** Log a structured sample once every N governor ticks. Default 4 (~32 s). */
  sampleEveryNTicks?: number
  /** RSS at/above which we fire an auto heap snapshot. Default = 80% of the
   *  real old-space ceiling (CLPZCODE_HEAP_MB / launcher formula). */
  rssDumpThresholdBytes?: number
  /** Max auto dumps per session. Default 3. */
  maxAutoDumps?: number
  /** Min ms between auto dumps. Default 120 s. */
  dumpCooldownMs?: number
  /** Injected for tests; defaults to process.memoryUsage. */
  readUsage?: () => NodeJS.MemoryUsage
  /** Injected for tests; defaults to Date.now. */
  now?: () => number
  /** Injected for tests; defaults to the real heap dump. */
  dump?: (trigger: 'auto-1.5GB', dumpNumber: number) => Promise<unknown>
}

const DEFAULT_SAMPLE_EVERY_N_TICKS = 4
const MB = 1024 * 1024

/**
 * Auto-dump threshold = 80% of the REAL old-space ceiling, not a fixed 9 GB.
 *
 * CALIBRATION BUG (was): a hard-coded 9 GB assumed an ~11 GB ceiling. On a host
 * the launcher clamps to a 4 GB ceiling (small box) the dump would never fire
 * before OOM; on a 16 GB-ceiling host it would fire late. Deriving from the
 * launcher's --max-old-space-size (CLPZCODE_HEAP_MB or clamp(totalmem*0.7,
 * [4096,16384])) keeps the dump below the ceiling on every host. RSS-based on
 * purpose: RSS is what the OOM killer watches. MEMORY-AND-RUNTIME-PLAN §2 #5.
 */
function defaultRssDumpThreshold(): number {
  const overrideMb = parseInt(process.env.CLPZCODE_HEAP_MB || '', 10)
  const ceilingMb =
    Number.isFinite(overrideMb) && overrideMb > 0
      ? overrideMb
      : Math.max(4096, Math.min(16384, Math.floor(totalmem() / MB * 0.7)))
  return Math.floor(ceilingMb * MB * 0.8)
}
const DEFAULT_MAX_AUTO_DUMPS = 3
const DEFAULT_DUMP_COOLDOWN_MS = 120_000

function snapshot(read: () => NodeJS.MemoryUsage, now: () => number): MemorySnapshot {
  const u = read()
  return {
    at: now(),
    rss: u.rss,
    heapUsed: u.heapUsed,
    heapTotal: u.heapTotal,
    external: u.external,
    arrayBuffers: u.arrayBuffers,
    native: u.rss - u.heapUsed,
  }
}

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(0)
const signedMb = (bytes: number): string =>
  `${bytes >= 0 ? '+' : ''}${mb(bytes)}`

/**
 * Format a structured, single-line sample. Includes deltas vs the first sample
 * so a reader can see at a glance whether growth is V8-heap or native.
 */
export function formatSample(s: MemorySnapshot, base: MemorySnapshot): string {
  const dHeap = s.heapUsed - base.heapUsed
  const dNative = s.native - base.native
  const dRss = s.rss - base.rss
  return (
    `[memSampler] rss=${mb(s.rss)}MB heapUsed=${mb(s.heapUsed)}MB ` +
    `native=${mb(s.native)}MB external=${mb(s.external)}MB ` +
    `arrayBuffers=${mb(s.arrayBuffers)}MB | ` +
    `Δrss=${signedMb(dRss)}MB Δheap=${signedMb(dHeap)}MB Δnative=${signedMb(dNative)}MB ` +
    `(growth is ${Math.abs(dNative) > Math.abs(dHeap) ? 'NATIVE-dominated' : 'HEAP-dominated'})`
  )
}

/**
 * Start the sampler. Idempotent per returned handle: call the returned stop fn
 * to unsubscribe. Wire this from the REPL effect that starts the governor.
 */
export function startMemorySampler(opts: MemorySamplerOptions = {}): () => void {
  const sampleEveryN = opts.sampleEveryNTicks ?? DEFAULT_SAMPLE_EVERY_N_TICKS
  const rssThreshold = opts.rssDumpThresholdBytes ?? defaultRssDumpThreshold()
  const maxDumps = opts.maxAutoDumps ?? DEFAULT_MAX_AUTO_DUMPS
  const cooldown = opts.dumpCooldownMs ?? DEFAULT_DUMP_COOLDOWN_MS
  const read = opts.readUsage ?? (() => process.memoryUsage())
  const now = opts.now ?? Date.now
  const dump = opts.dump ?? performHeapDump

  let tick = 0
  let base: MemorySnapshot | null = null
  let dumpsTaken = 0
  let lastDumpAt = 0
  let dumpInFlight = false

  const onTick = (): void => {
    const s = snapshot(read, now)
    if (base === null) {
      base = s
      logForDebugging(
        `[memSampler] baseline rss=${mb(s.rss)}MB heapUsed=${mb(s.heapUsed)}MB native=${mb(s.native)}MB`,
      )
    } else if (tick % sampleEveryN === 0) {
      logForDebugging(formatSample(s, base))
    }
    tick++

    // Auto snapshot near the ceiling — once, capped, cooldown-gated, and never
    // overlapping (the dump itself allocates; a second concurrent one could OOM).
    if (
      s.rss >= rssThreshold &&
      dumpsTaken < maxDumps &&
      !dumpInFlight &&
      now() - lastDumpAt >= cooldown
    ) {
      dumpInFlight = true
      lastDumpAt = now()
      dumpsTaken++
      const n = dumpsTaken
      logForDebugging(
        `[memSampler] rss ${mb(s.rss)}MB >= threshold ${mb(rssThreshold)}MB — firing auto heap dump #${n}`,
      )
      // performHeapDump already swallows its own errors and logs them.
      Promise.resolve(dump('auto-1.5GB', n)).finally(() => {
        dumpInFlight = false
      })
    }
  }

  // subscribeMemoryPressure fires once synchronously if a sample already exists,
  // then once per governor tick thereafter. We ignore the pressure payload and
  // re-read full memoryUsage() ourselves (the governor's MemorySample omits
  // external/arrayBuffers, which we specifically need for the V8-vs-native split).
  return subscribeMemoryPressure(onTick)
}

/** Test seam: pure helpers, no subscription. */
export const __test = {
  snapshot,
  formatSample,
}
