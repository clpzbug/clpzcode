import React, { useEffect, useState } from 'react';
import { extraUsage } from 'src/commands/extra-usage/index.js';
import { Box, Text } from 'src/ink.js';
import { useClaudeAiLimits } from 'src/services/claudeAiLimitsHook.js';
import { shouldProcessMockLimits } from 'src/services/rateLimitMocking.js'; // Used for /mock-limits command
import { getRateLimitTier, getSubscriptionType, isClaudeAISubscriber } from 'src/utils/auth.js';
import { hasClaudeAiBillingAccess } from 'src/utils/billing.js';
import { MessageResponse } from '../MessageResponse.js';
type UpsellParams = {
  shouldShowUpsell: boolean;
  isMax20x: boolean;
  isExtraUsageCommandEnabled: boolean;
  shouldAutoOpenRateLimitOptionsMenu: boolean;
  isTeamOrEnterprise: boolean;
  hasBillingAccess: boolean;
};
export function getUpsellMessage({
  shouldShowUpsell,
  isMax20x,
  isExtraUsageCommandEnabled,
  shouldAutoOpenRateLimitOptionsMenu,
  isTeamOrEnterprise,
  hasBillingAccess
}: UpsellParams): string | null {
  if (!shouldShowUpsell) return null;
  if (isMax20x) {
    if (isExtraUsageCommandEnabled) {
      return '/extra-usage to finish what you\u2019re working on.';
    }
    return '/login to switch to an API usage-billed account.';
  }
  if (shouldAutoOpenRateLimitOptionsMenu) {
    return 'Opening your options\u2026';
  }
  if (!isTeamOrEnterprise && !isExtraUsageCommandEnabled) {
    return '/upgrade to increase your usage limit.';
  }
  if (isTeamOrEnterprise) {
    if (!isExtraUsageCommandEnabled) return null;
    if (hasBillingAccess) {
      return '/extra-usage to finish what you\u2019re working on.';
    }
    return '/extra-usage to request more usage from your admin.';
  }
  return '/upgrade or /extra-usage to finish what you\u2019re working on.';
}
type RateLimitMessageProps = {
  text: string;
  onOpenRateLimitOptions?: () => void;
};
export function RateLimitMessage({ text, onOpenRateLimitOptions }: RateLimitMessageProps) {
  const subscriptionType = getSubscriptionType();
  const rateLimitTier = getRateLimitTier();
  const isTeamOrEnterprise = subscriptionType === "team" || subscriptionType === "enterprise";
  const isMax20x = rateLimitTier === "default_claude_max_20x";
  const shouldShowUpsell = shouldProcessMockLimits() || isClaudeAISubscriber();
  const canSeeRateLimitOptionsUpsell = shouldShowUpsell && !isMax20x;
  const [hasOpenedInteractiveMenu, setHasOpenedInteractiveMenu] = useState(false);
  const claudeAiLimits = useClaudeAiLimits();
  const isCurrentlyRateLimited = claudeAiLimits.status === "rejected" && claudeAiLimits.resetsAt !== undefined && !claudeAiLimits.isUsingOverage;
  const shouldAutoOpenRateLimitOptionsMenu = canSeeRateLimitOptionsUpsell && !hasOpenedInteractiveMenu && isCurrentlyRateLimited && onOpenRateLimitOptions;
  useEffect(() => {
    if (shouldAutoOpenRateLimitOptionsMenu) {
      setHasOpenedInteractiveMenu(true);
      onOpenRateLimitOptions();
    }
  }, [shouldAutoOpenRateLimitOptionsMenu, onOpenRateLimitOptions]);
  let upsell: React.ReactNode;
  bb0: {
    const message = getUpsellMessage({
      shouldShowUpsell,
      isMax20x,
      isExtraUsageCommandEnabled: extraUsage.isEnabled(),
      shouldAutoOpenRateLimitOptionsMenu: !!shouldAutoOpenRateLimitOptionsMenu,
      isTeamOrEnterprise,
      hasBillingAccess: hasClaudeAiBillingAccess()
    });
    if (!message) {
      upsell = null;
      break bb0;
    }
    upsell = <Text dimColor={true}>{message}</Text>;
  }
  const errorText = <Text color="error">{text}</Text>;
  const upsellContent = hasOpenedInteractiveMenu ? null : upsell;
  return <MessageResponse><Box flexDirection="column">{errorText}{upsellContent}</Box></MessageResponse>;
}
