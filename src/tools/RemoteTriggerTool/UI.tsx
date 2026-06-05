import React from 'react';
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { UPLOAD_FRAMES } from '../../constants/animGlyphs.js';
import { Box, Text } from '../../ink.js';
export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={UPLOAD_FRAMES} interval={80} loops={0} />
        <Text dimColor>Triggering…</Text>
      </Box>
    </MessageResponse>
  )
}
import { countCharInString } from '../../utils/stringUtils.js';
import type { Input, Output } from './RemoteTriggerTool.js';
export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  return `${input.action ?? ''}${input.trigger_id ? ` ${input.trigger_id}` : ''}`;
}
export function renderToolResultMessage(output: Output): React.ReactNode {
  const lines = countCharInString(output.json, '\n') + 1;
  return <MessageResponse>
      <Text>
        HTTP {output.status} <Text dimColor>({lines} lines)</Text>
      </Text>
    </MessageResponse>;
}
