import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { SCAN_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './ReconTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Recon…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (!content.success) {
    return (
      <MessageResponse height={1}>
        <Text color="error">{content.action}: failed</Text>
      </MessageResponse>
    )
  }
  const d = content.data as Record<string, unknown>
  if (content.action === 'crt_lookup') {
    const count = d.count as number
    return (
      <MessageResponse height={1}>
        <Text>{count} subdomain{count !== 1 ? 's' : ''}</Text>
      </MessageResponse>
    )
  }
  if (content.action === 'classify_endpoints') {
    const total = d.total as number
    return (
      <MessageResponse height={1}>
        <Text>{total} endpoint{total !== 1 ? 's' : ''} classified</Text>
      </MessageResponse>
    )
  }
  if (content.action === 'tech_detect') {
    const techs = d.technologies as string[]
    return (
      <MessageResponse height={1}>
        <Text>{techs.length ? techs.join(', ') : 'No tech detected'}</Text>
      </MessageResponse>
    )
  }
  return null
}
