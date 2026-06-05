import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { FOUND_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './ChainTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={FOUND_FRAMES} interval={80} loops={0} />
        <Text dimColor>Chaining vectors…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (!content.found) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>Unknown class: {content.bug_class}</Text>
      </MessageResponse>
    )
  }
  const preview = content.vectors.slice(0, 3).join(', ')
  const more = content.vectors.length > 3 ? ` +${content.vectors.length - 3}` : ''
  return (
    <MessageResponse height={1}>
      <Text>{content.vectors.length} vector{content.vectors.length !== 1 ? 's' : ''}: {preview}{more}</Text>
    </MessageResponse>
  )
}
