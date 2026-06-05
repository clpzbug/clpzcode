import { feature } from 'bun:bundle';
import * as React from 'react';
import { useSyncExternalStore } from 'react';
import { Box, Text } from '../ink.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { calculateTokenWarningState, getEffectiveContextWindowSize, isAutoCompactEnabled } from '../services/compact/autoCompact.js';
import { useCompactWarningSuppression } from '../services/compact/compactWarningHook.js';
import { getUpgradeMessage } from '../utils/model/contextWindowUpgradeCheck.js';
type Props = {
  tokenUsage: number;
  model: string;
};

/**
 * Live collapse progress: "x / y summarized". Sub-component so
 * useSyncExternalStore can subscribe to store mutations unconditionally
 * (hooks-in-conditionals would violate React rules). The parent only
 * renders this when feature('CONTEXT_COLLAPSE') + isContextCollapseEnabled().
 */
function CollapseLabel({ upgradeMessage }: { upgradeMessage: string | null }) {
  const {
    getStats,
    subscribe
  } = require("../services/contextCollapse/index.js") as typeof import('../services/contextCollapse/index.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshot = useSyncExternalStore(subscribe, () => {
    const s = getStats();
    const idleWarn = s.health.emptySpawnWarningEmitted ? 1 : 0;
    return `${s.collapsedSpans}|${s.stagedSpans}|${s.health.totalErrors}|${s.health.totalEmptySpawns}|${idleWarn}`;
  }) as any as string;
  const [collapsed, staged, errors, emptySpawns, idleWarn] = snapshot.split("|").map(Number) as [number, number, number, number, number];
  const total = collapsed + staged;
  if (errors > 0 || idleWarn) {
    const problem = errors > 0 ? `collapse errors: ${errors}` : `collapse idle (${emptySpawns} empty runs)`;
    const text = total > 0 ? `${collapsed} / ${total} summarized \u00b7 ${problem}` : problem;
    return <Text color="warning" wrap="truncate">{text}</Text>;
  }
  if (total === 0) {
    return null;
  }
  const label = `${collapsed} / ${total} summarized`;
  const text = upgradeMessage ? `${label} \u00b7 ${upgradeMessage}` : label;
  return <Text dimColor={true} wrap="truncate">{text}</Text>;
}
export function TokenWarning({ tokenUsage, model }: Props) {
  const {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold
  } = calculateTokenWarningState(tokenUsage, model);
  const suppressWarning = useCompactWarningSuppression();
  if (!isAboveWarningThreshold || suppressWarning) {
    return null;
  }
  const showAutoCompactWarning = isAutoCompactEnabled();
  const upgradeMessage = getUpgradeMessage("warning");
  let displayPercentLeft = percentLeft;
  let reactiveOnlyMode = false;
  let collapseMode = false;
  if (feature("REACTIVE_COMPACT")) {
    if (getFeatureValue_CACHED_MAY_BE_STALE("tengu_cobalt_raccoon", false)) {
      reactiveOnlyMode = true;
    }
  }
  if (feature("CONTEXT_COLLAPSE")) {
    const {
      isContextCollapseEnabled
    } = require("../services/contextCollapse/index.js") as typeof import('../services/contextCollapse/index.js');
    if (isContextCollapseEnabled()) {
      collapseMode = true;
    }
  }
  if (reactiveOnlyMode || collapseMode) {
    const effectiveWindow = getEffectiveContextWindowSize(model);
    displayPercentLeft = Math.max(0, Math.round((effectiveWindow - tokenUsage) / effectiveWindow * 100));
  }
  if (collapseMode && feature("CONTEXT_COLLAPSE")) {
    return <Box flexDirection="row"><CollapseLabel upgradeMessage={upgradeMessage} /></Box>;
  }
  const autocompactLabel = reactiveOnlyMode ? `${100 - displayPercentLeft}% context used` : `${displayPercentLeft}% until auto-compact`;
  return <Box flexDirection="row">{showAutoCompactWarning ? <Text dimColor={true} wrap="truncate">{upgradeMessage ? `${autocompactLabel} \u00b7 ${upgradeMessage}` : autocompactLabel}</Text> : <Text color={isAboveErrorThreshold ? "error" : "warning"} wrap="truncate">{upgradeMessage ? `Context low (${percentLeft}% remaining) \u00b7 ${upgradeMessage}` : `Context low (${percentLeft}% remaining) \u00b7 Run /compact to compact & continue`}</Text>}</Box>;
}
