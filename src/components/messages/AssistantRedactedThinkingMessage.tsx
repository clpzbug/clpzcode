import React from 'react';
import { Box, Text } from '../../ink.js';
type Props = {
  addMargin: boolean;
};
export function AssistantRedactedThinkingMessage({ addMargin = false }: Props) {
  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text dimColor={true} italic={true}>✻ Thinking…</Text>
    </Box>
  );
}
