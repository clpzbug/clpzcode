import type { StructuredPatchHunk } from 'diff';
import { relative } from 'path';
import * as React from 'react';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { getCwd } from 'src/utils/cwd.js';
import { Box, Text } from '../ink.js';
import { HighlightedCode } from './HighlightedCode.js';
import { MessageResponse } from './MessageResponse.js';
import { StructuredDiffList } from './StructuredDiffList.js';
const MAX_LINES_TO_RENDER = 10;
type Props = {
  file_path: string;
  operation: 'write' | 'update';
  // For updates - show diff
  patch?: StructuredPatchHunk[];
  firstLine: string | null;
  fileContent?: string;
  // For new file creation - show content preview
  content?: string;
  style?: 'condensed';
  verbose: boolean;
};
export function FileEditToolUseRejectedMessage({
  file_path,
  operation,
  patch,
  firstLine,
  fileContent,
  content,
  style,
  verbose
}: Props) {
  const {
    columns
  } = useTerminalSize();
  const displayPath = verbose ? file_path : relative(getCwd(), file_path);
  const text = <Box flexDirection="row"><Text color="subtle">User rejected {operation} to </Text><Text bold={true} color="subtle">{displayPath}</Text></Box>;
  if (style === "condensed" && !verbose) {
    return <MessageResponse>{text}</MessageResponse>;
  }
  if (operation === "write" && content !== undefined) {
    const lines = content.split("\n");
    const numLines = lines.length;
    const plusLines = numLines - MAX_LINES_TO_RENDER;
    const truncatedContent = verbose ? content : lines.slice(0, MAX_LINES_TO_RENDER).join("\n");
    const code = truncatedContent || "(No content)";
    return <MessageResponse><Box flexDirection="column">{text}<HighlightedCode code={code} filePath={file_path} width={columns - 12} dim={true} />{!verbose && plusLines > 0 && <Text dimColor={true}>… +{plusLines} lines</Text>}</Box></MessageResponse>;
  }
  if (!patch || patch.length === 0) {
    return <MessageResponse>{text}</MessageResponse>;
  }
  return <MessageResponse><Box flexDirection="column">{text}<StructuredDiffList hunks={patch} dim={true} width={columns - 12} filePath={file_path} firstLine={firstLine} fileContent={fileContent} /></Box></MessageResponse>;
}
