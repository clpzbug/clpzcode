import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { SCAN_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './NucleiTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Running templates…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && content.total === 0) {
    return (
      <MessageResponse height={1}>
        <Text color="error">Scan error</Text>
      </MessageResponse>
    )
  }
  if (content.total === 0) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>No findings</Text>
      </MessageResponse>
    )
  }
  const { critical, high, medium, low } = content.by_severity
  const sev: string[] = []
  if (critical) sev.push(`${critical}C`)
  if (high) sev.push(`${high}H`)
  if (medium) sev.push(`${medium}M`)
  if (low) sev.push(`${low}L`)
  return (
    <MessageResponse height={1}>
      <Text>
        {content.total} finding{content.total !== 1 ? 's' : ''}{sev.length ? ` · ${sev.join(' ')}` : ''}
      </Text>
    </MessageResponse>
  )
}
