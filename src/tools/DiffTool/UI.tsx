import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { SCAN_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './DiffTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Diffing…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error) {
    return (
      <MessageResponse height={1}>
        <Text color="error">Diff error</Text>
      </MessageResponse>
    )
  }
  const anomalies = content.results.filter(r => r.anomaly_score >= 50)
  if (anomalies.length === 0) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>No anomalies</Text>
      </MessageResponse>
    )
  }
  return (
    <MessageResponse height={1}>
      <Text>{anomalies.length} anomal{anomalies.length !== 1 ? 'ies' : 'y'} detected</Text>
    </MessageResponse>
  )
}
