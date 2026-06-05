import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './OAuthTool.js'

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
  if (content.error && !content.vulnerable) {
    return (
      <MessageResponse height={1}>
        <Text color="error">OAuth test error</Text>
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
  const vulnFindings = content.findings.filter(f => f.vulnerable)
  const sevOrder = ['critical', 'high', 'medium', 'low', 'info']
  const worst = [...vulnFindings].sort((a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity))[0]
  return (
    <MessageResponse height={1}>
      <Text>OAuth: {worst?.severity ?? 'issue'} · {vulnFindings.length} finding{vulnFindings.length !== 1 ? 's' : ''}</Text>
    </MessageResponse>
  )
}
