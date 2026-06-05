import type { OverageDisabledReason } from 'src/services/claudeAiLimits.js'
import { isClaudeAISubscriber } from '../auth.js'
import { getGlobalConfig } from '../config.js'
import { is1mContextDisabled } from '../context.js'

/**
 * Check if extra usage is enabled based on the cached disabled reason.
 * Extra usage is considered enabled if there's no disabled reason,
 * or if the disabled reason indicates it's provisioned but temporarily unavailable.
 */
function isExtraUsageEnabled(): boolean {
  const reason = getGlobalConfig().cachedExtraUsageDisabledReason
  // undefined = no cache yet, treat as not enabled (conservative)
  if (reason === undefined) {
    return false
  }
  // null = no disabled reason from API, extra usage is enabled
  if (reason === null) {
    return true
  }
  // Check which disabled reasons still mean "provisioned"
  switch (reason as OverageDisabledReason) {
    // Provisioned but credits depleted — still counts as enabled
    case 'out_of_credits':
      return true
    // Not provisioned or actively disabled
    case 'overage_not_provisioned':
    case 'org_level_disabled':
    case 'org_level_disabled_until':
    case 'seat_tier_level_disabled':
    case 'member_level_disabled':
    case 'seat_tier_zero_credit_limit':
    case 'group_zero_credit_limit':
    case 'member_zero_credit_limit':
    case 'org_service_level_disabled':
    case 'org_service_zero_credit_limit':
    case 'no_limits_configured':
    case 'unknown':
      return false
    default:
      return false
  }
}

export function checkOpus1mAccess(): boolean {
  return !is1mContextDisabled()
}

export function checkSonnet1mAccess(): boolean {
  return !is1mContextDisabled()
}
