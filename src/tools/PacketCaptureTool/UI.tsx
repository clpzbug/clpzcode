import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { SCAN_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './PacketCaptureTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Capturing…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && content.total_packets === 0) {
    return (
      <MessageResponse height={1}>
        <Text color="error">capture error</Text>
      </MessageResponse>
    )
  }
  const n = content.total_packets
  return (
    <MessageResponse height={1}>
      <Text dimColor>{n} packet{n !== 1 ? 's' : ''} captured</Text>
    </MessageResponse>
  )
}
