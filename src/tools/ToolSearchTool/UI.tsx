import * as React from 'react'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { SCAN_FRAMES } from '../../constants/animGlyphs.js'
import { Box, Text } from '../../ink.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Searching tools…</Text>
      </Box>
    </MessageResponse>
  )
}
