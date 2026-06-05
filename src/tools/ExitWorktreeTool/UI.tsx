import * as React from 'react';
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { SCAN_FRAMES } from '../../constants/animGlyphs.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import type { ThemeName } from '../../utils/theme.js';
import type { Output } from './ExitWorktreeTool.js';
export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Exiting worktree…</Text>
      </Box>
    </MessageResponse>
  )
}
export function renderToolUseMessage(): React.ReactNode {
  return 'Exiting worktree…';
}
export function renderToolResultMessage(output: Output, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], _options: {
  theme: ThemeName;
}): React.ReactNode {
  const actionLabel = output.action === 'keep' ? 'Kept worktree' : 'Removed worktree';
  return <Box flexDirection="column">
      <Text>
        {actionLabel}
        {output.worktreeBranch ? <>
            {' '}
            (branch <Text bold>{output.worktreeBranch}</Text>)
          </> : null}
      </Text>
      <Text dimColor>Returned to {output.originalCwd}</Text>
    </Box>;
}
