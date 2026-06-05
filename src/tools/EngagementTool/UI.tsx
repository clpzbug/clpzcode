import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './EngagementTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Updating engagement…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  const msg = content.message.length > 60 ? content.message.substring(0, 60) + '…' : content.message
  return (
    <MessageResponse height={1}>
      <Text dimColor>{msg}</Text>
    </MessageResponse>
  )
}
