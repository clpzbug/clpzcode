import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

/**
 * GrowthBook config for time-based microcompact.
 *
 * Triggers content-clearing microcompact when the gap since the last main-loop
 * assistant message exceeds a threshold — the server-side prompt cache has
 * almost certainly expired, so the full prefix will be rewritten anyway.
 * Clearing old tool results before the request shrinks what gets rewritten.
 *
 * Runs BEFORE the API call (in microcompactMessages, upstream of callModel)
 * so the shrunk prompt is what actually gets sent. Running after the first
 * miss would only help subsequent turns.
 *
 * Main thread only — subagents have short lifetimes where gap-based eviction
 * doesn't apply.
 */
export type TimeBasedMCConfig = {
  /** Master switch. When false, time-based microcompact is a no-op. */
  enabled: boolean
  /** Trigger when (now − last assistant timestamp) exceeds this many minutes.
   *  60 is the safe choice: the server's 1h cache TTL is guaranteed expired
   *  for all users, so we never force a miss that wouldn't have happened. */
  gapThresholdMinutes: number
  /** Keep this many most-recent compactable tool results.
   *  When set, takes priority over any default; older results are cleared. */
  keepRecent: number
}

const TIME_BASED_MC_CONFIG_DEFAULTS: TimeBasedMCConfig = {
  enabled: false,
  gapThresholdMinutes: 60,
  keepRecent: 5,
}

const timeBasedMCConfigSchema = z.object({
  enabled: z.boolean(),
  /** Between 10 min and 24h — anything outside this range is likely misconfigured. */
  gapThresholdMinutes: z.number().min(10).max(1440),
  /** At least 1, at most 50 recent tool results to keep. */
  keepRecent: z.number().int().min(1).max(50),
})

export function getTimeBasedMCConfig(): TimeBasedMCConfig {
  // Hoist the GB read so exposure fires on every eval path, not just when
  // the caller's other conditions (querySource, messages.length) pass.
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_slate_heron',
    TIME_BASED_MC_CONFIG_DEFAULTS,
  )
  const parsed = timeBasedMCConfigSchema.safeParse(raw)
  return parsed.success ? parsed.data : TIME_BASED_MC_CONFIG_DEFAULTS
}
