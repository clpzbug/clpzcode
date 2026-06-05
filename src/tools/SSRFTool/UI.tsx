import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { UPLOAD_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './SSRFTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={UPLOAD_FRAMES} interval={80} loops={0} />
        <Text dimColor>Probing…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && !content.vulnerable) {
    return (
      <MessageResponse height={1}>
        <Text color="error">SSRF error</Text>
      </MessageResponse>
    )
  }
  if (!content.vulnerable) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>No SSRF found</Text>
      </MessageResponse>
    )
  }
  const critical = content.probes.filter(p => p.severity === 'critical').length
  return (
    <MessageResponse height={1}>
      <Text>SSRF detected{critical > 0 ? ` · ${critical} critical` : ''}</Text>
    </MessageResponse>
  )
}
