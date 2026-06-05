import { feature } from 'bun:bundle'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import React, { useContext, useMemo } from 'react'
import { getKairosActive, getUserMsgOptIn } from '../../bootstrap/state.js'
import { Box, Text } from '../../ink.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { useAppState } from '../../state/AppState.js'
import { GLYPH } from '../../tui/design/index.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logError } from '../../utils/log.js'
import { countCharInString } from '../../utils/stringUtils.js'
import { MessageActionsSelectedContext } from '../messageActions.js'
import { HighlightedThinkingText } from './HighlightedThinkingText.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
  isTranscriptMode?: boolean
  timestamp?: string
}

// Hard cap on displayed prompt text. Piping large files via stdin
// (e.g. `cat 11k-line-file | claude`) creates a single user message whose
// <Text> node the fullscreen Ink renderer must wrap/output on every frame,
// causing 500ms+ keystroke latency. React.memo skips the React render but
// the Ink output pass still iterates the full mounted text. Non-fullscreen
// avoids this via <Static> (print-and-forget to terminal scrollback).
// Head+tail because `{ cat file; echo prompt; } | claude` puts the user's
// actual question at the end.
const MAX_DISPLAY_CHARS = 10_000
const TRUNCATE_HEAD_CHARS = 2_500
const TRUNCATE_TAIL_CHARS = 2_500

export function UserPromptMessage({
  addMargin,
  param: { text },
  isTranscriptMode,
  timestamp,
}: Props): React.ReactNode {
  // REPL.tsx passes isBriefOnly={viewedTeammateTask ? false : isBriefOnly}
  // but that prop isn't threaded this deep — replicate the override by
  // reading viewingAgentTaskId directly. Computed here (not in the child)
  // so the parent Box can drop its backgroundColor: in brief mode the
  // child renders a label-style layout, and Box backgroundColor paints
  // behind children unconditionally (they can't opt out).
  //
  // Hooks stay INSIDE feature() ternaries so external builds don't pay
  // the per-scrollback-message store subscription (useSyncExternalStore
  // bypasses React.memo). Runtime-gated like isBriefEnabled() but inlined
  // to avoid pulling BriefTool.ts → prompt.ts tool-name strings into
  // external builds.
  const isBriefOnly =
    feature('KAIROS') || feature('KAIROS_BRIEF')
      ? // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
        useAppState(s => s.isBriefOnly)
      : false
  const viewingAgentTaskId =
    feature('KAIROS') || feature('KAIROS_BRIEF')
      ? // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
        useAppState(s => s.viewingAgentTaskId)
      : null
  // Hoisted to mount-time — per-message component, re-renders on every scroll.
  const briefEnvEnabled =
    feature('KAIROS') || feature('KAIROS_BRIEF')
      ? // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
        useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_BRIEF), [])
      : false
  const useBriefLayout =
    feature('KAIROS') || feature('KAIROS_BRIEF')
      ? (getKairosActive() ||
          (getUserMsgOptIn() &&
            (briefEnvEnabled ||
              getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_brief', false)))) &&
        isBriefOnly &&
        !isTranscriptMode &&
        !viewingAgentTaskId
      : false

  // Truncate before the early return so the hook order is stable.
  const displayText = useMemo(() => {
    if (text.length <= MAX_DISPLAY_CHARS) return text
    const head = text.slice(0, TRUNCATE_HEAD_CHARS)
    const tail = text.slice(-TRUNCATE_TAIL_CHARS)
    const hiddenLines =
      countCharInString(text, '\n', TRUNCATE_HEAD_CHARS) - countCharInString(tail, '\n')
    return `${head}\n… +${hiddenLines} lines …\n${tail}`
  }, [text])

  const isSelected = useContext(MessageActionsSelectedContext)

  if (!text) {
    logError(new Error('No content found in user prompt message'))
    return null
  }

  // Layout brief: o próprio HighlightedThinkingText desenha o cabeçalho "You".
  // Caso contrário, layout Zen: chevron de prompt no gutter + texto branco puro,
  // sem fundo. Selecionado pinta o fundo de ação (foco real, não decoração).
  if (useBriefLayout) {
    return (
      <Box
        flexDirection="column"
        marginTop={addMargin ? 1 : 0}
        backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
      >
        <HighlightedThinkingText
          text={displayText}
          useBriefLayout
          timestamp={timestamp}
        />
      </Box>
    )
  }

  // A solid accent rail marks the user turn — a 1-cell solid-fill Box (seamless
  // at any height) that turns to the focus color when selected. No resting panel
  // background; selection paints messageActionsBackground (focus affordance).
  return (
    <Box
      flexDirection="row"
      marginTop={addMargin ? 1 : 0}
      alignItems="stretch"
      backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
    >
      <Box width={1} flexShrink={0} backgroundColor={isSelected ? 'suggestion' : 'claude'} />
      <Box flexDirection="row" flexGrow={1} paddingX={2} paddingY={1}>
        <Box minWidth={2} flexShrink={0}>
          <Text color={isSelected ? 'suggestion' : 'inactive'}>{GLYPH.prompt}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text color="text">{displayText}</Text>
        </Box>
      </Box>
    </Box>
  )
}
