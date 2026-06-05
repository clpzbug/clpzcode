import figures from 'figures';
import React, { useMemo } from 'react';
import type { DiffFile } from '../../hooks/useDiffData.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text } from '../../ink.js';
import { truncateStartToWidth } from '../../utils/format.js';
import { plural } from '../../utils/stringUtils.js';
const MAX_VISIBLE_FILES = 5;
type Props = {
  files: DiffFile[];
  selectedIndex: number;
};
export function DiffFileList({ files, selectedIndex }: Props) {
  const { columns } = useTerminalSize();
  const { startIndex, endIndex } = useMemo(() => {
    if (files.length === 0 || files.length <= MAX_VISIBLE_FILES) {
      return { startIndex: 0, endIndex: files.length };
    }
    let start = Math.max(0, selectedIndex - Math.floor(MAX_VISIBLE_FILES / 2));
    let end = start + MAX_VISIBLE_FILES;
    if (end > files.length) {
      end = files.length;
      start = Math.max(0, end - MAX_VISIBLE_FILES);
    }
    return { startIndex: start, endIndex: end };
  }, [files.length, selectedIndex]);
  if (files.length === 0) {
    return <Text dimColor={true}>No changed files</Text>;
  }
  const visibleFiles = files.slice(startIndex, endIndex);
  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < files.length;
  const needsPagination = files.length > MAX_VISIBLE_FILES;
  const maxPathWidth = Math.max(20, columns - 16 - 3 - 4);
  return (
    <Box flexDirection="column">
      {needsPagination && <Text dimColor={true}>{hasMoreAbove ? ` ↑ ${startIndex} more ${plural(startIndex, "file")}` : " "}</Text>}
      {visibleFiles.map((file, index) => <FileItem key={file.path} file={file} isSelected={startIndex + index === selectedIndex} maxPathWidth={maxPathWidth} />)}
      {needsPagination && <Text dimColor={true}>{hasMoreBelow ? ` ↓ ${files.length - endIndex} more ${plural(files.length - endIndex, "file")}` : " "}</Text>}
    </Box>
  );
}
function FileItem({ file, isSelected, maxPathWidth }: { file: DiffFile; isSelected: boolean; maxPathWidth: number }) {
  const displayPath = truncateStartToWidth(file.path, maxPathWidth);
  const pointer = isSelected ? figures.pointer + " " : "  ";
  const line = `${pointer}${displayPath}`;
  return (
    <Box flexDirection="row">
      <Text bold={isSelected} color={isSelected ? "background" : undefined} inverse={isSelected}>{line}</Text>
      <Box flexGrow={1} />
      <FileStats file={file} isSelected={isSelected} />
    </Box>
  );
}
function FileStats({ file, isSelected }: { file: DiffFile; isSelected: boolean }) {
  if (file.isUntracked) {
    return <Text dimColor={!isSelected} italic={true}>untracked</Text>;
  }
  if (file.isBinary) {
    return <Text dimColor={!isSelected} italic={true}>Binary file</Text>;
  }
  if (file.isLargeFile) {
    return <Text dimColor={!isSelected} italic={true}>Large file modified</Text>;
  }
  return (
    <Text>
      {file.linesAdded > 0 && <Text color="diffAddedWord" bold={isSelected}>+{file.linesAdded}</Text>}
      {file.linesAdded > 0 && file.linesRemoved > 0 && " "}
      {file.linesRemoved > 0 && <Text color="diffRemovedWord" bold={isSelected}>-{file.linesRemoved}</Text>}
      {file.isTruncated && <Text dimColor={!isSelected}> (truncated)</Text>}
    </Text>
  );
}
