import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { Markdown } from '../Markdown.js';
type Props = {
  addMargin: boolean;
  planContent: string;
};
export function UserPlanMessage({ addMargin, planContent }: Props) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="planMode" marginTop={addMargin ? 1 : 0} paddingX={1} paddingY={1}>
      <Box marginBottom={1}><Text bold={true} color="planMode">Plan to implement</Text></Box>
      <Markdown>{planContent}</Markdown>
    </Box>
  );
}
