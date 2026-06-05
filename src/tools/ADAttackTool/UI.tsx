import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { ATTACK_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './ADAttackTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={ATTACK_FRAMES} interval={80} loops={0} />
        <Text dimColor>Attacking…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && !content.success) {
    return (
      <MessageResponse height={1}>
        <Text color="error">{content.action}: failed</Text>
      </MessageResponse>
    )
  }
  return (
    <MessageResponse height={1}>
      <Text>{content.action}: {content.success ? 'OK' : 'FAILED'}</Text>
    </MessageResponse>
  )
}
