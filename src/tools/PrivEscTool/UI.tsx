import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { ATTACK_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './PrivEscTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={ATTACK_FRAMES} interval={80} loops={0} />
        <Text dimColor>Enumerating vectors…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error) {
    return (
      <MessageResponse height={1}>
        <Text color="error">PrivEsc error</Text>
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
  if (sev.low) parts.push(`${sev.low}L`)
  if (parts.length === 0) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>No vectors found</Text>
      </MessageResponse>
    )
  }
  return (
    <MessageResponse height={1}>
      <Text>{content.findings.length} finding{content.findings.length !== 1 ? 's' : ''} · {parts.join(' ')}</Text>
    </MessageResponse>
  )
}
