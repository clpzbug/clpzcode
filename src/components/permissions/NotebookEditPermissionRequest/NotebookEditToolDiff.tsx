import { relative } from 'path';
import * as React from 'react';
import { Suspense, use, useMemo } from 'react';
import { Box, NoSelect, Text } from '../../../ink.js';
import type { NotebookCellType, NotebookContent } from '../../../types/notebook.js';
import { intersperse } from '../../../utils/array.js';
import { getCwd } from '../../../utils/cwd.js';
import { getPatchForDisplay } from '../../../utils/diff.js';
import { getFsImplementation } from '../../../utils/fsOperations.js';
import { safeParseJSON } from '../../../utils/json.js';
import { parseCellId } from '../../../utils/notebook.js';
import { HighlightedCode } from '../../HighlightedCode.js';
import { StructuredDiff } from '../../StructuredDiff.js';
type Props = {
  notebook_path: string;
  cell_id: string | undefined;
  new_source: string;
  cell_type?: NotebookCellType;
  edit_mode?: string;
  verbose: boolean;
  width: number;
};
type InnerProps = {
  notebook_path: string;
  cell_id: string | undefined;
  new_source: string;
  cell_type?: NotebookCellType;
  edit_mode?: string;
  verbose: boolean;
  width: number;
  promise: Promise<NotebookContent | null>;
};
export function NotebookEditToolDiff(props: Props) {
  const notebookDataPromise = useMemo(
    () =>
      getFsImplementation()
        .readFile(props.notebook_path, { encoding: 'utf-8' })
        .then(parseNotebookContent)
        .catch(returnNull),
    [props.notebook_path],
  );
  return (
    <Suspense fallback={null}>
      <NotebookEditToolDiffInner {...props} promise={notebookDataPromise} />
    </Suspense>
  );
}
function returnNull() {
  return null;
}
function parseNotebookContent(content: string) {
  return safeParseJSON(content) as NotebookContent | null;
}
function NotebookEditToolDiffInner({
  notebook_path,
  cell_id,
  new_source,
  cell_type,
  edit_mode = 'replace',
  verbose,
  width,
  promise,
}: InnerProps) {
  const notebookData = use(promise) as any;
  const oldSource = useMemo(() => {
    if (!notebookData || !cell_id) {
      return '';
    }
    const cellIndex = parseCellId(cell_id);
    if (cellIndex !== undefined) {
      if (notebookData.cells[cellIndex]) {
        const source = notebookData.cells[cellIndex].source;
        return Array.isArray(source) ? source.join('') : source;
      }
      return '';
    }
    const cell = notebookData.cells.find((cell: any) => cell.id === cell_id);
    if (!cell) {
      return '';
    }
    return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
  }, [cell_id, notebookData]);
  const hunks =
    !notebookData || edit_mode === 'insert' || edit_mode === 'delete'
      ? null
      : getPatchForDisplay({
          filePath: notebook_path,
          fileContents: oldSource,
          edits: [
            {
              old_string: oldSource,
              new_string: new_source,
              replace_all: false,
            },
          ],
          ignoreWhitespace: false,
        });
  let editTypeDescription: string;
  switch (edit_mode) {
    case 'insert': {
      editTypeDescription = 'Insert new cell';
      break;
    }
    case 'delete': {
      editTypeDescription = 'Delete cell';
      break;
    }
    default: {
      editTypeDescription = 'Replace cell contents';
    }
  }
  const displayPath = verbose ? notebook_path : relative(getCwd(), notebook_path);
  const cellTypeSuffix = cell_type ? ` (${cell_type})` : '';
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Box paddingBottom={1} flexDirection="column">
          <Text bold={true}>{displayPath}</Text>
          <Text dimColor={true}>
            {editTypeDescription} for cell {cell_id}
            {cellTypeSuffix}
          </Text>
        </Box>
        {edit_mode === 'delete' ? (
          <Box flexDirection="column" paddingLeft={2}>
            <HighlightedCode code={oldSource} filePath={notebook_path} />
          </Box>
        ) : edit_mode === 'insert' ? (
          <Box flexDirection="column" paddingLeft={2}>
            <HighlightedCode
              code={new_source}
              filePath={cell_type === 'markdown' ? 'file.md' : notebook_path}
            />
          </Box>
        ) : hunks ? (
          intersperse(
            hunks.map(_ => (
              <StructuredDiff
                key={_.newStart}
                patch={_}
                dim={false}
                width={width}
                filePath={notebook_path}
                firstLine={new_source.split('\n')[0] ?? null}
                fileContent={oldSource}
              />
            )),
            renderEllipsis,
          )
        ) : (
          <HighlightedCode
            code={new_source}
            filePath={cell_type === 'markdown' ? 'file.md' : notebook_path}
          />
        )}
      </Box>
    </Box>
  );
}
function renderEllipsis(i: number) {
  return (
    <NoSelect fromLeftEdge={true} key={`ellipsis-${i}`}>
      <Text dimColor={true}>...</Text>
    </NoSelect>
  );
}
