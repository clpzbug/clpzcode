import React from 'react';
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { PROBE_FRAMES } from '../../constants/animGlyphs.js';
import { Box, Text } from '../../ink.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import type { Input, Output } from './ConfigTool.js';
export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Configuring…</Text>
      </Box>
    </MessageResponse>
  )
}
export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  if (!input.setting) return null;
  if (input.value === undefined) {
    return <Text dimColor>Getting {input.setting}</Text>;
  }
  return <Text dimColor>
      Setting {input.setting} to {jsonStringify(input.value)}
    </Text>;
}
export function renderToolResultMessage(content: Output): React.ReactNode {
  if (!content.success) {
    return <MessageResponse>
        <Text color="error">Failed: {content.error}</Text>
      </MessageResponse>;
  }
  if (content.operation === 'get') {
    return <MessageResponse>
        <Text>
          <Text bold>{content.setting}</Text> = {jsonStringify(content.value)}
        </Text>
      </MessageResponse>;
  }
  return <MessageResponse>
      <Text>
        Set <Text bold>{content.setting}</Text> to{' '}
        <Text bold>{jsonStringify(content.newValue)}</Text>
      </Text>
    </MessageResponse>;
}
export function renderToolUseRejectedMessage(): React.ReactNode {
  return <Text color="warning">Config change rejected</Text>;
}
