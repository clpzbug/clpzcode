import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './CORSTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Testing…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error) {
    return (
      <MessageResponse height={1}>
        <Text color="error">CORS error</Text>
      </MessageResponse>
    )
  }
  const vuln = content.results.filter(r => r.vulnerable)
  if (vuln.length === 0) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>Not vulnerable</Text>
      </MessageResponse>
    )
  }
  const sevOrder = ['critical', 'high', 'medium', 'low', 'info']
  const worst = vuln.sort((a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity))[0]
  return (
    <MessageResponse height={1}>
      <Text>CORS: {worst.severity} · {vuln.length} bypass{vuln.length !== 1 ? 'es' : ''}</Text>
    </MessageResponse>
  )
}
