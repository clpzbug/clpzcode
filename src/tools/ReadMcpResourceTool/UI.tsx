import * as React from 'react';
import type { z } from 'zod/v4';
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { PROBE_FRAMES } from '../../constants/animGlyphs.js';
import { OutputLine } from '../../components/shell/OutputLine.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import type { inputSchema, Output } from './ReadMcpResourceTool.js';
export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Reading resource…</Text>
      </Box>
    </MessageResponse>
  )
}
export function renderToolUseMessage(input: Partial<z.infer<ReturnType<typeof inputSchema>>>): React.ReactNode {
  if (!input.uri || !input.server) {
    return null;
  }
  return `Read resource "${input.uri}" from server "${input.server}"`;
}
export function userFacingName(): string {
  return 'readMcpResource';
}
export function renderToolResultMessage(output: Output, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!output || !output.contents || output.contents.length === 0) {
    return <Box justifyContent="space-between" overflowX="hidden" width="100%">
        <MessageResponse height={1}>
          <Text dimColor>(No content)</Text>
        </MessageResponse>
      </Box>;
  }

  // Format as JSON for better readability
  // eslint-disable-next-line no-restricted-syntax -- human-facing UI, not tool_result
  const formattedOutput = jsonStringify(output, null, 2);
  return <OutputLine content={formattedOutput} verbose={verbose} />;
}
