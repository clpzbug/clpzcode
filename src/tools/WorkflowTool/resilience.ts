// Resilience policy for workflow agent nodes: classify a failure and resolve an
// ordered model-fallback chain so a node can "se virar" (cope) and the run is
// never interrupted by a single agent error. Pure + dependency-free so it is
// unit-testable and reusable by the engine and (potentially) ad-hoc sub-agents.

export type ModelErrorKind =
  /** Network/rate-limit/5xx/timeout — worth retrying, same model first. */
  | 'transient'
  /** Context window exhausted — same model will fail again; switch model. */
  | 'context'
  /** Auth / invalid request / unknown model — retrying won't help. Stop. */
  | 'fatal'

const CONTEXT_RE =
  /context[\s_-]?(?:length|window|limit)|prompt is too long|too many tokens|maximum (?:context|tokens)|exceeded the context|compaction has failed|reduce the (?:length|number of tokens)|context_length_exceeded/i

const FATAL_RE =
  /\b(?:401|403)\b|invalid[\s_-]?(?:api[\s_-]?key|x[\s_-]?api[\s_-]?key|authentication|request)|authentication[\s_-]?error|permission denied|unauthorized|model[\s_:].*(?:not found|does not exist|unsupported|invalid)|invalid model|unknown model/i

const TRANSIENT_RE =
  /\b(?:429|500|502|503|529)\b|rate[\s_-]?limit|overloaded|too many requests|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|socket hang ?up|network|fetch failed|temporarily unavailable|service unavailable|connection (?:reset|refused|closed)|stream (?:error|interrupted)/i

/**
 * Classify an agent error. Order matters: context and fatal are checked before
 * the broad transient net. Unknown errors default to 'transient' so the policy
 * gives them a bounded retry rather than failing the flow on a novel message.
 */
export function classifyModelError(err: unknown): ModelErrorKind {
  const msg =
    err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ''}` : String(err ?? '')
  if (CONTEXT_RE.test(msg)) return 'context'
  if (FATAL_RE.test(msg)) return 'fatal'
  if (TRANSIENT_RE.test(msg)) return 'transient'
  return 'transient'
}

/**
 * Ordered list of fallback models to try after `primary` fails, drawn from the
 * user-configured chain plus the parent/main-loop model as an implicit last
 * resort. Excludes the primary, de-dupes, and is capped so a flailing node can
 * never fan out into an unbounded model sweep.
 */
export function resolveFallbackChain(
  primary: string | undefined,
  configured: readonly string[] | undefined,
  parentModel: string | undefined,
  cap = 3,
  /**
   * Optional routability gate. Per-request routing only exists for OpenAI-compat
   * targets (xAI via providerOverride) and for native-Anthropic targets when the
   * ambient provider env is NOT pinned to an OpenAI-compat vendor. Offering an
   * unroutable model would misroute it (e.g. an Anthropic id shipped to the xAI
   * endpoint under a Grok main loop) and waste the attempt — so the caller filters
   * the chain to what the current process can actually reach (and is authed for).
   */
  isRoutable?: (model: string) => boolean,
): string[] {
  const out: string[] = []
  const seen = new Set<string>(primary ? [primary] : [])
  for (const m of [...(configured ?? []), ...(parentModel ? [parentModel] : [])]) {
    if (!m || seen.has(m)) continue
    seen.add(m)
    if (isRoutable && !isRoutable(m)) continue
    out.push(m)
    if (out.length >= cap) break
  }
  return out
}

export type AgentAttempt = { model: string | undefined; reason: 'primary' | 'retry' | 'fallback' }

/**
 * Build the bounded, ordered sequence of (model, reason) attempts for one node,
 * given how many same-model retries are configured and the fallback chain. The
 * engine walks this list, stopping early on a 'fatal' classification.
 *
 *   primary, [retry × sameModelRetries], fallback#1, fallback#2, …
 */
export function buildAttemptPlan(
  primary: string | undefined,
  sameModelRetries: number,
  fallbacks: readonly string[],
): AgentAttempt[] {
  const plan: AgentAttempt[] = [{ model: primary, reason: 'primary' }]
  for (let i = 0; i < Math.max(0, sameModelRetries); i++) {
    plan.push({ model: primary, reason: 'retry' })
  }
  for (const m of fallbacks) plan.push({ model: m, reason: 'fallback' })
  return plan
}
