import * as React from 'react';
import { useMemo } from 'react';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { Box, NoSelect, Text } from '../../../ink.js';
import { intersperse } from '../../../utils/array.js';
import { getPatchForDisplay } from '../../../utils/diff.js';
import { HighlightedCode } from '../../HighlightedCode.js';
import { StructuredDiff } from '../../StructuredDiff.js';
type Props = {
  file_path: string;
  content: string;
  fileExists: boolean;
  oldContent: string;
};
export function FileWriteToolDiff({ file_path, content, fileExists, oldContent }: Props) {
  const { columns } = useTerminalSize();

  const hunks = useMemo(() => {
    if (!fileExists) {
      return null;
    }
    return getPatchForDisplay({
      filePath: file_path,
      fileContents: oldContent,
      edits: [{
        old_string: oldContent,
        new_string: content,
        replace_all: false
      }]
    });
  }, [fileExists, content, file_path, oldContent]);

  const firstLine = useMemo(() => content.split("\n")[0] ?? null, [content]);

  const diffContent = useMemo(() => hunks ? intersperse(hunks.map(_ => <StructuredDiff key={_.newStart} patch={_} dim={false} filePath={file_path} firstLine={firstLine} fileContent={oldContent} width={columns - 2} />), _temp) : <HighlightedCode code={content || "(No content)"} filePath={file_path} />, [columns, content, file_path, firstLine, hunks, oldContent]);

  return <Box flexDirection="column"><Box borderColor="subtle" borderStyle="dashed" flexDirection="column" borderLeft={false} borderRight={false} paddingX={1}>{diffContent}</Box></Box>;
}
function _temp(i) {
  return <NoSelect fromLeftEdge={true} key={`ellipsis-${i}`}><Text dimColor={true}>...</Text></NoSelect>;
}
