import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PAYLOAD_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './RequestSmugglingTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PAYLOAD_FRAMES} interval={80} loops={0} />
        <Text dimColor>Smuggling…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && !content.vulnerable) {
    return (
      <MessageResponse height={1}>
        <Text color="error">smuggling test error</Text>
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
  const detected = content.results.filter(r => r.detected)
  return (
    <MessageResponse height={1}>
      <Text>Vulnerable: {detected[0]?.type ?? 'smuggling'}</Text>
    </MessageResponse>
  )
}
