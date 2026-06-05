import * as React from 'react';
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { SCAN_FRAMES } from '../../constants/animGlyphs.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import type { ThemeName } from '../../utils/theme.js';
import type { Output } from './EnterWorktreeTool.js';
export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Creating worktree…</Text>
      </Box>
    </MessageResponse>
  )
}
export function renderToolUseMessage(): React.ReactNode {
  return 'Creating worktree…';
}
export function renderToolResultMessage(output: Output, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], _options: {
  theme: ThemeName;
}): React.ReactNode {
  return <Box flexDirection="column">
      <Text>
        Switched to worktree on branch <Text bold>{output.worktreeBranch}</Text>
      </Text>
      <Text dimColor>{output.worktreePath}</Text>
    </Box>;
}
