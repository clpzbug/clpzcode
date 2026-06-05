import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { CRACK_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './HashTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={CRACK_FRAMES} interval={80} loops={0} />
        <Text dimColor>Cracking…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error) {
    return (
      <MessageResponse height={1}>
        <Text color="error">Hash error</Text>
      </MessageResponse>
    )
  }
  if (content.cracked === true) {
    return <MessageResponse height={1}><Text>Cracked</Text></MessageResponse>
  }
  if (content.cracked === false) {
    return <MessageResponse height={1}><Text dimColor>Not cracked</Text></MessageResponse>
  }
  return null
}
