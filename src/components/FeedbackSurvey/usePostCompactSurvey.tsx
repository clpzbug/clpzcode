import { useEffect, useRef, useState } from 'react';
import { isFeedbackSurveyDisabled } from 'src/services/analytics/config.js';
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { shouldUseSessionMemoryCompaction } from '../../services/compact/sessionMemoryCompact.js';
import type { Message } from '../../types/message.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { isCompactBoundaryMessage } from '../../utils/messages.js';
import { useSurveyState } from './useSurveyState.js';
import type { FeedbackSurveyResponse } from './utils.js';
const HIDE_THANKS_AFTER_MS = 3000;
const POST_COMPACT_SURVEY_GATE = 'tengu_post_compact_survey';
const SURVEY_PROBABILITY = 0.2; // Show survey 20% of the time after compaction

function hasMessageAfterBoundary(messages: Message[], boundaryUuid: string): boolean {
  const boundaryIndex = messages.findIndex(msg => msg.uuid === boundaryUuid);
  if (boundaryIndex === -1) {
    return false;
  }

  // Check if there's a user or assistant message after the boundary
  for (let i = boundaryIndex + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg && (msg.type === 'user' || msg.type === 'assistant')) {
      return true;
    }
  }
  return false;
}

function onOpen(appearanceId: string): void {
  const smCompactionEnabled = shouldUseSessionMemoryCompaction();
  logEvent("tengu_post_compact_survey_event", {
    event_type: "appeared" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    session_memory_compaction_enabled: smCompactionEnabled as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
}

function onSelect(appearanceId: string, selected: FeedbackSurveyResponse): void {
  const smCompactionEnabled = shouldUseSessionMemoryCompaction();
  logEvent("tengu_post_compact_survey_event", {
    event_type: "responded" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    response: selected as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    session_memory_compaction_enabled: smCompactionEnabled as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
}

export function usePostCompactSurvey(messages: Message[], isLoading: boolean, hasActivePrompt = false, {
  enabled = true
}: {
  enabled?: boolean;
} = {}): {
  state: 'closed' | 'open' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted';
  lastResponse: FeedbackSurveyResponse | null;
  handleSelect: (selected: FeedbackSurveyResponse) => boolean;
} {
  const [gateEnabled, setGateEnabled] = useState<boolean | null>(null);
  const seenCompactBoundaries = useRef(new Set<string>());
  const pendingCompactBoundaryUuid = useRef<string | null>(null);
  const {
    state,
    lastResponse,
    open,
    handleSelect
  } = useSurveyState({
    hideThanksAfterMs: HIDE_THANKS_AFTER_MS,
    onOpen,
    onSelect
  });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    setGateEnabled(checkStatsigFeatureGate_CACHED_MAY_BE_STALE(POST_COMPACT_SURVEY_GATE));
  }, [enabled]);
  const currentCompactBoundaries = new Set(messages.filter(msg => isCompactBoundaryMessage(msg)).map(msg => msg.uuid));
  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (state !== "closed" || isLoading) {
      return;
    }
    if (hasActivePrompt) {
      return;
    }
    if (gateEnabled !== true) {
      return;
    }
    if (isFeedbackSurveyDisabled()) {
      return;
    }
    if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY)) {
      return;
    }
    if (pendingCompactBoundaryUuid.current !== null) {
      if (hasMessageAfterBoundary(messages, pendingCompactBoundaryUuid.current)) {
        pendingCompactBoundaryUuid.current = null;
        if (Math.random() < SURVEY_PROBABILITY) {
          open();
        }
        return;
      }
    }
    const newBoundaries = Array.from(currentCompactBoundaries).filter(uuid => !seenCompactBoundaries.current.has(uuid));
    if (newBoundaries.length > 0) {
      seenCompactBoundaries.current = new Set(currentCompactBoundaries);
      pendingCompactBoundaryUuid.current = newBoundaries[newBoundaries.length - 1] as any;
    }
  }, [enabled, currentCompactBoundaries, state, isLoading, hasActivePrompt, gateEnabled, messages, open]);
  return {
    state,
    lastResponse,
    handleSelect
  };
}
