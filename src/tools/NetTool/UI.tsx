import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './NetTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Probing…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && !content.connected) {
    return (
      <MessageResponse height={1}>
        <Text color="error">{content.host}: error</Text>
      </MessageResponse>
    )
  }
  if (content.port_results) {
    const open = content.port_results.filter(p => p.open).length
    return (
      <MessageResponse height={1}>
        <Text>{open} open / {content.port_results.length} ports</Text>
      </MessageResponse>
    )
  }
  const portStr = content.port ? `:${content.port}` : ''
  return (
    <MessageResponse height={1}>
      <Text dimColor>{content.host}{portStr} {content.connected ? 'open' : 'closed'}</Text>
    </MessageResponse>
  )
}
