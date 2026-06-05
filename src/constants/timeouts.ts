/**
 * Shared timeout constants.
 * Import from here to avoid silent desync between services that use the same value.
 */

/** Timeout for remote loading promises (policy limits, managed settings). */
export const LOADING_PROMISE_TIMEOUT_MS = 30_000
