import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js';
import { Box, Text } from '../../ink.js';
import { PromptInputHelpMenu } from '../PromptInput/PromptInputHelpMenu.js';

export function General() {
  return (
    <Box flexDirection="column" paddingY={1} gap={1}>
      <Box>
        <Text>
          {PRODUCT_DISPLAY_NAME} understands your codebase, makes edits with your permission, and executes commands — right from your terminal.
        </Text>
      </Box>
      <Box flexDirection="column">
        <Box>
          <Text bold={true}>Shortcuts</Text>
        </Box>
        <PromptInputHelpMenu gap={2} fixedWidth={true} />
      </Box>
    </Box>
  );
}
