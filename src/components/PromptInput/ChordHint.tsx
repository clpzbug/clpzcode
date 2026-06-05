import * as React from 'react'
import {
  chordActionLabel,
  chordContinuations,
} from '../../keybindings/chordContinuations.js'
import { useOptionalKeybindingContext } from '../../keybindings/KeybindingContext.js'
import { Box, Text } from '../../ink.js'
import { role } from '../../tui/design/tokens.js'

/**
 * which-key style hint: when the user has started a multi-key chord (e.g.
 * ctrl+x), show the possible NEXT keystrokes + their actions in the footer so
 * chords are discoverable. Self-gating — renders NOTHING unless a chord is
 * pending (pendingChord flips only on chord start/cancel, so no re-render
 * churn). Footer placement (vs a floating popup) avoids the single-slot prompt
 * overlay collision and the overflow clip, and is always visible.
 */
export function ChordHint(): React.ReactNode {
  const ctx = useOptionalKeybindingContext()
  const pending = ctx?.pendingChord
  if (!ctx || !pending || pending.length === 0) return null
  const conts = chordContinuations(pending, ctx.bindings, ctx.activeContexts)
  if (conts.length === 0) return null
  return (
    <Box flexDirection="row" gap={2} flexWrap="wrap">
      {conts.map(c => (
        <Text key={`${c.nextKey} ${c.action}`} wrap="truncate">
          <Text color={role('accent')}>{c.nextKey}</Text>
          <Text color={role('muted')}> {chordActionLabel(c.action)}</Text>
        </Text>
      ))}
    </Box>
  )
}
