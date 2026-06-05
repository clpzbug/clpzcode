import React from 'react';
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { PROBE_FRAMES } from '../../constants/animGlyphs.js';
import { Box, Text } from '../../ink.js';
import type { Input } from './TeamCreateTool.js';
export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Creating team…</Text>
      </Box>
    </MessageResponse>
  )
}
export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  return `create team: ${input.team_name}`;
}
