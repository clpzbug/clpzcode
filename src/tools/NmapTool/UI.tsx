import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { SCAN_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './NmapTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Scanning…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && content.hosts.length === 0) {
    return (
      <MessageResponse height={1}>
        <Text color="error">Scan error</Text>
      </MessageResponse>
    )
  }
  const openPorts = content.hosts.reduce((sum, h) => sum + h.ports.length, 0)
  return (
    <MessageResponse height={1}>
      <Text>
        {content.up_hosts} host{content.up_hosts !== 1 ? 's' : ''} up · {openPorts} open port{openPorts !== 1 ? 's' : ''}
      </Text>
    </MessageResponse>
  )
}
