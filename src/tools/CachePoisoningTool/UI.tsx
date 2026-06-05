import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PAYLOAD_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './CachePoisoningTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PAYLOAD_FRAMES} interval={80} loops={0} />
        <Text dimColor>Poisoning…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && !content.vulnerable) {
    return (
      <MessageResponse height={1}>
        <Text color="error">Cache error</Text>
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
  const sev = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of content.findings) {
    const s = f.severity as keyof typeof sev
    if (s in sev) sev[s]++
  }
  const parts: string[] = []
  if (sev.critical) parts.push(`${sev.critical}C`)
  if (sev.high) parts.push(`${sev.high}H`)
  if (sev.medium) parts.push(`${sev.medium}M`)
  return (
    <MessageResponse height={1}>
      <Text>Cache poisoned{parts.length ? ` · ${parts.join(' ')}` : ''}</Text>
    </MessageResponse>
  )
}
