import React from 'react';
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { PROBE_FRAMES } from '../../constants/animGlyphs.js';
import { Box, Text } from '../../ink.js';
import { jsonParse } from '../../utils/slowOperations.js';
import type { Output } from './TeamDeleteTool.js';
export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Cleaning up team…</Text>
      </Box>
    </MessageResponse>
  )
}
export function renderToolUseMessage(_input: Record<string, unknown>): React.ReactNode {
  return 'cleanup team: current';
}
export function renderToolResultMessage(content: Output | string, _progressMessages: unknown, {
  verbose: _verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  const result: Output = typeof content === 'string' ? jsonParse(content) : content;

  // Suppress cleanup result - the batched shutdown message covers this
  if ('success' in result && 'team_name' in result && 'message' in result) {
    return null;
  }
  return null;
}
