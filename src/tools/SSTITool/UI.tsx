import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './SSTITool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Testing templates…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error) {
    return (
      <MessageResponse height={1}>
        <Text color="error">SSTI error</Text>
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
  const parts: string[] = []
  if (content.engine) parts.push(content.engine)
  if (content.rce_output) parts.push(`RCE: ${content.rce_output.substring(0, 30)}`)
  return (
    <MessageResponse height={1}>
      <Text>Vulnerable{parts.length ? ` (${parts.join(', ')})` : ''}</Text>
    </MessageResponse>
  )
}
