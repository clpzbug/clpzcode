import * as React from 'react';
import { Markdown } from 'src/components/Markdown.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { Box, Text } from '../../../ink.js';
type Props = {
  plan: string;
};
export function RejectedPlanMessage({ plan }: Props) {
  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="subtle">User rejected the plan:</Text>
        <Box borderStyle="round" borderColor="planMode" paddingX={1} overflow="hidden">
          <Markdown>{plan}</Markdown>
        </Box>
      </Box>
    </MessageResponse>
  );
}
