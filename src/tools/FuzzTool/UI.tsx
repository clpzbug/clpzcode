import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { ATTACK_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './FuzzTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={ATTACK_FRAMES} interval={80} loops={0} />
        <Text dimColor>Fuzzing…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && content.total_hits === 0) {
    return (
      <MessageResponse height={1}>
        <Text color="error">Fuzz error</Text>
      </MessageResponse>
    )
  }
  const n = content.total_hits
  return (
    <MessageResponse height={1}>
      <Text>{n} hit{n !== 1 ? 's' : ''}</Text>
    </MessageResponse>
  )
}
