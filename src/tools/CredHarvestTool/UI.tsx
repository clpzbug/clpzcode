import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { EXFIL_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './CredHarvestTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={EXFIL_FRAMES} interval={80} loops={0} />
        <Text dimColor>Harvesting…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && content.total_findings === 0) {
    return (
      <MessageResponse height={1}>
        <Text color="error">scan error</Text>
      </MessageResponse>
    )
  }
  const n = content.total_findings
  if (n === 0) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>No secrets · {content.files_scanned} files</Text>
      </MessageResponse>
    )
  }
  return (
    <MessageResponse height={1}>
      <Text>{n} secret{n !== 1 ? 's' : ''} · {content.files_scanned} files</Text>
    </MessageResponse>
  )
}
