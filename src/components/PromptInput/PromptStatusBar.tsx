// src/components/PromptInput/PromptStatusBar.tsx
//
// grok-style persistent status bar: a single subtle row below the prompt with
// the active model + context-window gauge on the left and the working dir on
// the right. Fullscreen only — it costs one ScrollBox row, and scrollback has
// its own footer flow. Color is signal-only: the context gauge turns to
// `warning` when the window is nearly full, everything else stays muted.

import { basename } from 'path'
import * as React from 'react'
import { useMemo } from 'react'
import { getSdkBetas } from '../../bootstrap/state.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'
import { role } from '../../tui/design/index.js'
import type { Message } from '../../types/message.js'
import { calculateContextPercentages, getContextWindowForModel } from '../../utils/context.js'
import { getCwd } from '../../utils/cwd.js'
import { getRuntimeMainLoopModel, renderModelName } from '../../utils/model/model.js'
import { doesMostRecentAssistantMessageExceed200k, getCurrentUsage } from '../../utils/tokens.js'

// Two-step gauge: warm accent as a soft "filling up" nudge, amber reserved for a
// true ceiling — no calm→alarm cliff, and no new color enters the budget.
const CONTEXT_WARN_PCT = 92
const CONTEXT_NUDGE_PCT = 85

export type GaugeLevel = 'calm' | 'nudge' | 'alarm'

/** Pure threshold logic (testable in isolation): calm < 85 ≤ nudge < 92 ≤ alarm. */
export function gaugeLevel(contextUsed: number | null): GaugeLevel {
  if (contextUsed == null) return 'calm'
  if (contextUsed >= CONTEXT_WARN_PCT) return 'alarm'
  if (contextUsed >= CONTEXT_NUDGE_PCT) return 'nudge'
  return 'calm'
}

export function PromptStatusBar({ messages }: { messages: Message[] }): React.ReactNode {
  const mainLoopModel = useMainLoopModel()
  const permissionMode = useAppState(s => s.toolPermissionContext.mode)

  const { modelLabel, contextUsed, dir } = useMemo(() => {
    const exceeds200kTokens = doesMostRecentAssistantMessageExceed200k(messages)
    const runtimeModel = getRuntimeMainLoopModel({ permissionMode, mainLoopModel, exceeds200kTokens })
    const usage = getCurrentUsage(messages)
    const windowSize = getContextWindowForModel(runtimeModel, getSdkBetas())
    const cwd = getCwd()
    return {
      modelLabel: renderModelName(runtimeModel),
      // Show context USED, not remaining: "34% context" reads naturally as
      // "34% full". The baseline (~system prompt + tools + CLAUDE.md + memory)
      // is real, not a bug — surfacing it as the used fraction avoids the
      // "66% — but I only said hi" misread of a remaining gauge.
      contextUsed: calculateContextPercentages(usage, windowSize).used,
      dir: basename(cwd) || cwd,
    }
  }, [messages, permissionMode, mainLoopModel])

  // Hierarchy: the static model name whispers (subtle); the LIVE values — context
  // fill and cwd — are the legible ones (inactive). The gauge is the only thing
  // that ever takes color, and only as a signal.
  const level = gaugeLevel(contextUsed)
  const gaugeColor = level === 'alarm' ? 'warning' : level === 'nudge' ? role('accent') : 'inactive'
  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={2} height={1} gap={2}>
      <Box flexDirection="row" flexShrink={1}>
        <Text color="subtle" wrap="truncate-end">{modelLabel}</Text>
        {contextUsed != null && (
          <>
            <Text color="subtle"> · </Text>
            <Text color={gaugeColor}>{contextUsed}%</Text>
          </>
        )}
      </Box>
      <Box flexShrink={0}>
        <Text color="inactive" wrap="truncate-start">{dir}</Text>
      </Box>
    </Box>
  )
}
