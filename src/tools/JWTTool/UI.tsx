import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './JWTTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Analyzing…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error) {
    return (
      <MessageResponse height={1}>
        <Text color="error">{content.action}: error</Text>
      </MessageResponse>
    )
  }
  switch (content.action) {
    case 'decode':
      return <MessageResponse height={1}><Text>alg: {content.algorithm ?? 'unknown'}</Text></MessageResponse>
    case 'check_exp':
      if (content.is_expired) {
        return <MessageResponse height={1}><Text>Expired</Text></MessageResponse>
      }
      return <MessageResponse height={1}><Text dimColor>{content.expiry_info ?? 'Valid'}</Text></MessageResponse>
    case 'crack':
      if (content.cracked) {
        return <MessageResponse height={1}><Text>Cracked: {content.cracked_secret}</Text></MessageResponse>
      }
      return <MessageResponse height={1}><Text dimColor>Not cracked</Text></MessageResponse>
    default:
      return content.finding
        ? <MessageResponse height={1}><Text>{content.finding}</Text></MessageResponse>
        : null
  }
}
