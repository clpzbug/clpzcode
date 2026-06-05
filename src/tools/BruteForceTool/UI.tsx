import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { ATTACK_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './BruteForceTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={ATTACK_FRAMES} interval={80} loops={0} />
        <Text dimColor>Brute-forcing…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && content.total_found === 0) {
    return (
      <MessageResponse height={1}>
        <Text color="error">BruteForce error</Text>
      </MessageResponse>
    )
  }
  const n = content.total_found
  if (n === 0) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>No credentials found</Text>
      </MessageResponse>
    )
  }
  return (
    <MessageResponse height={1}>
      <Text>{n} credential{n !== 1 ? 's' : ''} found</Text>
    </MessageResponse>
  )
}
