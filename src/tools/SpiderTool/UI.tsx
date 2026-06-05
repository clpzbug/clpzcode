import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { SCAN_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './SpiderTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Crawling…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error) {
    return (
      <MessageResponse height={1}>
        <Text color="error">Spider error</Text>
      </MessageResponse>
    )
  }
  const n = content.endpoints.length
  return (
    <MessageResponse height={1}>
      <Text>
        {content.pages_visited} page{content.pages_visited !== 1 ? 's' : ''} · {n} endpoint{n !== 1 ? 's' : ''}
      </Text>
    </MessageResponse>
  )
}
