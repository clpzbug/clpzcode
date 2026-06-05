import type { StructuredPatchHunk } from 'diff';
import { resolve } from 'path';
import React, { useMemo } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text } from '../../ink.js';
import { getCwd } from '../../utils/cwd.js';
import { readFileSafe } from '../../utils/file.js';
import { Divider } from '../design-system/Divider.js';
import { StructuredDiff } from '../StructuredDiff.js';
type Props = {
  filePath: string;
  hunks: StructuredPatchHunk[];
  isLargeFile?: boolean;
  isBinary?: boolean;
  isTruncated?: boolean;
  isUntracked?: boolean;
};

/**
 * Displays the diff content for a single file.
 * Uses StructuredDiff for word-level diffing and syntax highlighting.
 * No scrolling - renders all lines (max 400 due to parsing limits).
 */
export function DiffDetailView({
  filePath,
  hunks,
  isLargeFile,
  isBinary,
  isTruncated,
  isUntracked,
}: Props) {
  const { columns } = useTerminalSize();

  const { firstLine, fileContent } = useMemo(() => {
    if (!filePath) {
      return { firstLine: null, fileContent: undefined };
    }
    const fullPath = resolve(getCwd(), filePath);
    const content = readFileSafe(fullPath);
    return {
      firstLine: content?.split("\n")[0] ?? null,
      fileContent: content ?? undefined,
    };
  }, [filePath]);

  if (isUntracked) {
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text bold={true}>{filePath}</Text>
          <Text dimColor={true}> (untracked)</Text>
        </Box>
        <Divider padding={4} />
        <Box flexDirection="column">
          <Text dimColor={true} italic={true}>New file not yet staged.</Text>
          <Text dimColor={true} italic={true}>Run `git add {filePath}` to see line counts.</Text>
        </Box>
      </Box>
    );
  }

  if (isBinary) {
    return (
      <Box flexDirection="column" width="100%">
        <Box><Text bold={true}>{filePath}</Text></Box>
        <Divider padding={4} />
        <Box flexDirection="column"><Text dimColor={true} italic={true}>Binary file - cannot display diff</Text></Box>
      </Box>
    );
  }

  if (isLargeFile) {
    return (
      <Box flexDirection="column" width="100%">
        <Box><Text bold={true}>{filePath}</Text></Box>
        <Divider padding={4} />
        <Box flexDirection="column"><Text dimColor={true} italic={true}>Large file - diff exceeds 1 MB limit</Text></Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text bold={true}>{filePath}</Text>
        {isTruncated && <Text dimColor={true}> (truncated)</Text>}
      </Box>
      <Divider padding={4} />
      <Box flexDirection="column">
        {hunks.length === 0 ? (
          <Text dimColor={true}>No diff content</Text>
        ) : (
          hunks.map((hunk, index) => (
            <StructuredDiff
              key={index}
              patch={hunk}
              filePath={filePath}
              firstLine={firstLine}
              fileContent={fileContent}
              dim={false}
              width={columns - 2 - 2}
            />
          ))
        )}
      </Box>
      {isTruncated && <Text dimColor={true} italic={true}>… diff truncated (exceeded 400 line limit)</Text>}
    </Box>
  );
}
