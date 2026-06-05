import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './PayloadTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Loading…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error) {
    return (
      <MessageResponse height={1}>
        <Text color="error">payload error</Text>
      </MessageResponse>
    )
  }
  if (content.operation === 'list' && content.categories) {
    const n = content.categories.length
    return (
      <MessageResponse height={1}>
        <Text dimColor>{n} categor{n !== 1 ? 'ies' : 'y'}</Text>
      </MessageResponse>
    )
  }
  if (content.operation === 'get' && content.category_matched) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>{content.category_matched}</Text>
      </MessageResponse>
    )
  }
  if (content.operation === 'search') {
    const n = content.total_results ?? 0
    return (
      <MessageResponse height={1}>
        <Text dimColor>{n} result{n !== 1 ? 's' : ''}</Text>
      </MessageResponse>
    )
  }
  return null
}
