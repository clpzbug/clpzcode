import * as React from 'react';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
type Props = {
  instructions?: string;
};
export function AgentNavigationFooter({ instructions = "Press ↑↓ to navigate \xB7 Enter to select \xB7 Esc to go back" }: Props) {
  const exitState = useExitOnCtrlCDWithKeybindings();
  const text = exitState.pending ? `Press ${exitState.keyName} again to exit` : instructions;
  return <Box marginLeft={2}><Text dimColor={true}>{text}</Text></Box>;
}
