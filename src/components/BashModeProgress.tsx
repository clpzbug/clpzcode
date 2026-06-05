import React from 'react';
import { Box } from '../ink.js';
import { BashTool } from '../tools/BashTool/BashTool.js';
import type { ShellProgress } from '../types/tools.js';
import { UserBashInputMessage } from './messages/UserBashInputMessage.js';
import { ShellProgressMessage } from './shell/ShellProgressMessage.js';
type Props = {
  input: string;
  progress: ShellProgress | null;
  verbose: boolean;
};
export function BashModeProgress({ input, progress, verbose }: Props) {
  const inputText = `<bash-input>${input}</bash-input>`;
  const inputMessage = <UserBashInputMessage addMargin={false} param={{
    text: inputText,
    type: "text"
  }} />;
  const progressMessage = progress ? <ShellProgressMessage fullOutput={progress.fullOutput} output={progress.output} elapsedTimeSeconds={progress.elapsedTimeSeconds} totalLines={progress.totalLines} verbose={verbose} /> : BashTool.renderToolUseProgressMessage?.([], {
    verbose,
    tools: [],
    terminalSize: undefined
  });
  return <Box flexDirection="column" marginTop={1}>{inputMessage}{progressMessage}</Box>;
}
