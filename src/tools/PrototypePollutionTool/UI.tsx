import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PAYLOAD_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './PrototypePollutionTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PAYLOAD_FRAMES} interval={80} loops={0} />
        <Text dimColor>Polluting…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (!content.vulnerable) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>Not vulnerable</Text>
      </MessageResponse>
    )
  }
  const vulnProbes = content.probes.filter(p => p.vulnerable)
  const sevOrder = ['critical', 'high', 'medium', 'low', 'info']
  const worst = [...vulnProbes].sort((a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity))[0]
  return (
    <MessageResponse height={1}>
      <Text>Polluted ({worst?.severity ?? 'confirmed'})</Text>
    </MessageResponse>
  )
}
