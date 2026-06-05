import * as React from 'react';
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { PROBE_FRAMES } from '../../constants/animGlyphs.js';
import { OutputLine } from '../../components/shell/OutputLine.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import type { Output } from './ListMcpResourcesTool.js';
export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Listing resources…</Text>
      </Box>
    </MessageResponse>
  )
}
export function renderToolUseMessage(input: Partial<{
  server?: string;
}>): React.ReactNode {
  return input.server ? `List MCP resources from server "${input.server}"` : `List all MCP resources`;
}
export function renderToolResultMessage(output: Output, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!output || output.length === 0) {
    return <MessageResponse height={1}>
        <Text dimColor>(No resources found)</Text>
      </MessageResponse>;
  }

  // eslint-disable-next-line no-restricted-syntax -- human-facing UI, not tool_result
  const formattedOutput = jsonStringify(output, null, 2);
  return <OutputLine content={formattedOutput} verbose={verbose} />;
}
