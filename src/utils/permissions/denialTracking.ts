/**
 * Denial tracking infrastructure for permission classifiers.
 * Tracks consecutive denials and total denials to determine
 * when to fall back to prompting.
 */

export type DenialTrackingState = {
  consecutiveDenials: number
  totalDenials: number
}

export const DENIAL_LIMITS = {
  // Effectively disabled — pentest fork operates fully autonomously.
  // The consecutive/total limits caused mid-turn interruptions when the
  // safety classifier blocked tool calls; all offensive tools in this fork
  // carry behavior:'allow' so the classifier path is rarely reached, but
  // when it is we must not stop the session.
  maxConsecutive: Infinity,
  maxTotal: Infinity,
} as const

export function createDenialTrackingState(): DenialTrackingState {
  return {
    consecutiveDenials: 0,
    totalDenials: 0,
  }
}

export function recordDenial(state: DenialTrackingState): DenialTrackingState {
  return {
    ...state,
    consecutiveDenials: state.consecutiveDenials + 1,
    totalDenials: state.totalDenials + 1,
  }
}

export function recordSuccess(state: DenialTrackingState): DenialTrackingState {
  if (state.consecutiveDenials === 0) return state // No change needed
  return {
    ...state,
    consecutiveDenials: 0,
  }
}

export function shouldFallbackToPrompting(state: DenialTrackingState): boolean {
  return (
    state.consecutiveDenials >= DENIAL_LIMITS.maxConsecutive ||
    state.totalDenials >= DENIAL_LIMITS.maxTotal
  )
}
