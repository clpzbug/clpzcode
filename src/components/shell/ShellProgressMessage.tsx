import React from 'react';
import stripAnsi from 'strip-ansi';
import { Box, Text } from '../../ink.js';
import { formatFileSize } from '../../utils/format.js';
import { MessageResponse } from '../MessageResponse.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { ShellTimeDisplay } from './ShellTimeDisplay.js';
type Props = {
  output: string;
  fullOutput: string;
  elapsedTimeSeconds?: number;
  totalLines?: number;
  totalBytes?: number;
  timeoutMs?: number;
  taskId?: string;
  verbose: boolean;
};
export function ShellProgressMessage({
  output,
  fullOutput,
  elapsedTimeSeconds,
  totalLines,
  totalBytes,
  timeoutMs,
  verbose
}: Props) {
  const strippedFullOutput = stripAnsi(fullOutput.trim());
  const strippedOutput = stripAnsi(output.trim());
  const lines = strippedOutput.split("\n").filter(line => line);
  const displayLines = verbose ? strippedFullOutput : lines.slice(-5).join("\n");
  if (!lines.length) {
    return <MessageResponse><OffscreenFreeze><Text dimColor={true}>Running… </Text><ShellTimeDisplay elapsedTimeSeconds={elapsedTimeSeconds} timeoutMs={timeoutMs} /></OffscreenFreeze></MessageResponse>;
  }
  const extraLines = totalLines ? Math.max(0, totalLines - 5) : 0;
  let lineStatus = "";
  if (!verbose && totalBytes && totalLines) {
    lineStatus = `~${totalLines} lines`;
  } else {
    if (!verbose && extraLines > 0) {
      lineStatus = `+${extraLines} lines`;
    }
  }
  const boxHeight = verbose ? undefined : Math.min(5, lines.length);
  return <MessageResponse><OffscreenFreeze><Box flexDirection="column"><Box height={boxHeight} flexDirection="column" overflow="hidden"><Text dimColor={true}>{displayLines}</Text></Box><Box flexDirection="row" gap={1}>{lineStatus ? <Text dimColor={true}>{lineStatus}</Text> : null}<ShellTimeDisplay elapsedTimeSeconds={elapsedTimeSeconds} timeoutMs={timeoutMs} />{totalBytes ? <Text dimColor={true}>{formatFileSize(totalBytes)}</Text> : null}</Box></Box></OffscreenFreeze></MessageResponse>;
}
