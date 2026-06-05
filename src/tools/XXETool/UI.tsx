import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PAYLOAD_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './XXETool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PAYLOAD_FRAMES} interval={80} loops={0} />
        <Text dimColor>Injecting…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && !content.vulnerable) {
    return (
      <MessageResponse height={1}>
        <Text color="error">XXE error</Text>
      </MessageResponse>
    )
  }
  if (!content.vulnerable) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>Not vulnerable</Text>
      </MessageResponse>
    )
  }
  return (
    <MessageResponse height={1}>
      <Text>XXE confirmed</Text>
    </MessageResponse>
  )
}
