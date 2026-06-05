import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { Text } from 'src/ink.js';
import { getRateLimitWarning, getUsingOverageText } from 'src/services/claudeAiLimits.js';
import { useClaudeAiLimits } from 'src/services/claudeAiLimitsHook.js';
import { getSubscriptionType } from 'src/utils/auth.js';
import { hasClaudeAiBillingAccess } from 'src/utils/billing.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
export function useRateLimitWarningNotification(model: string) {
  const {
    addNotification
  } = useNotifications();
  const claudeAiLimits = useClaudeAiLimits();
  const rateLimitWarning = getRateLimitWarning(claudeAiLimits, model);
  const usingOverageText = getUsingOverageText(claudeAiLimits);
  const shownWarningRef = useRef<string | null>(null);
  const subscriptionType = getSubscriptionType();
  const hasBillingAccess = hasClaudeAiBillingAccess();
  const isTeamOrEnterprise = subscriptionType === "team" || subscriptionType === "enterprise";
  const [hasShownOverageNotification, setHasShownOverageNotification] = useState(false);
  useEffect(() => {
    if (getIsRemoteMode()) {
      return;
    }
    if (claudeAiLimits.isUsingOverage && !hasShownOverageNotification && (!isTeamOrEnterprise || hasBillingAccess)) {
      addNotification({
        key: "limit-reached",
        text: usingOverageText,
        priority: "immediate"
      });
      setHasShownOverageNotification(true);
    } else {
      if (!claudeAiLimits.isUsingOverage && hasShownOverageNotification) {
        setHasShownOverageNotification(false);
      }
    }
  }, [claudeAiLimits.isUsingOverage, usingOverageText, hasShownOverageNotification, addNotification, hasBillingAccess, isTeamOrEnterprise]);
  useEffect(() => {
    if (getIsRemoteMode()) {
      return;
    }
    if (rateLimitWarning && rateLimitWarning !== shownWarningRef.current) {
      shownWarningRef.current = rateLimitWarning;
      addNotification({
        key: "rate-limit-warning",
        jsx: <Text><Text color="warning">{rateLimitWarning}</Text></Text>,
        priority: "high"
      });
    }
  }, [rateLimitWarning, addNotification]);
}
