import * as React from 'react';
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { SCAN_FRAMES } from '../../constants/animGlyphs.js';
import { BLACK_CIRCLE } from 'src/constants/figures.js';
import { PRODUCT_DISPLAY_NAME } from 'src/constants/product.js';
import { getModeColor } from 'src/utils/permissions/PermissionMode.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import type { ThemeName } from '../../utils/theme.js';
import type { Output } from './EnterPlanModeTool.js';
export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Planning…</Text>
      </Box>
    </MessageResponse>
  )
}
export function renderToolUseMessage(): React.ReactNode {
  return null;
}
export function renderToolResultMessage(_output: Output, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], _options: {
  theme: ThemeName;
}): React.ReactNode {
  return <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text color={getModeColor('plan')}>{BLACK_CIRCLE}</Text>
        <Text> Entered plan mode</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>
          {PRODUCT_DISPLAY_NAME} is now exploring and designing an implementation approach.
        </Text>
      </Box>
    </Box>;
}
export function renderToolUseRejectedMessage(): React.ReactNode {
  return <Box flexDirection="row" marginTop={1}>
      <Text color={getModeColor('default')}>{BLACK_CIRCLE}</Text>
      <Text> User declined to enter plan mode</Text>
    </Box>;
}
