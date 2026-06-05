import { basename, relative } from 'path';
import React, { Suspense, use } from 'react';
import { FileEditToolDiff } from 'src/components/FileEditToolDiff.js';
import { getCwd } from 'src/utils/cwd.js';
import { isENOENT } from 'src/utils/errors.js';
import { detectEncodingForResolvedPath } from 'src/utils/fileRead.js';
import { getFsImplementation } from 'src/utils/fsOperations.js';
import { Text } from '../../../ink.js';
import { BashTool } from '../../../tools/BashTool/BashTool.js';
import { applySedSubstitution, type SedEditInfo } from '../../../tools/BashTool/sedEditParser.js';
import { FilePermissionDialog } from '../FilePermissionDialog/FilePermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
type SedEditPermissionRequestProps = PermissionRequestProps & {
  sedInfo: SedEditInfo;
};
type FileReadResult = {
  oldContent: string;
  fileExists: boolean;
};
export function SedEditPermissionRequest({
  sedInfo,
  ...props
}: SedEditPermissionRequestProps) {
  const { filePath } = sedInfo;
  const contentPromise = (async () => {
    const encoding = detectEncodingForResolvedPath(filePath);
    const raw = await getFsImplementation().readFile(filePath, {
      encoding,
    });
    return {
      oldContent: raw.replaceAll('\r\n', '\n'),
      fileExists: true,
    };
  })().catch(_temp);
  return (
    <Suspense fallback={null}>
      <SedEditPermissionRequestInner sedInfo={sedInfo} contentPromise={contentPromise} {...props} />
    </Suspense>
  );
}
function _temp(e: unknown): FileReadResult {
  if (!isENOENT(e)) {
    throw e;
  }
  return {
    oldContent: '',
    fileExists: false,
  };
}
function SedEditPermissionRequestInner({
  sedInfo,
  contentPromise,
  ...props
}: SedEditPermissionRequestProps & { contentPromise: Promise<FileReadResult> }) {
  const { filePath } = sedInfo;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { oldContent, fileExists } = use(contentPromise) as any;
  const newContent = applySedSubstitution(oldContent, sedInfo);
  const edits =
    oldContent === newContent
      ? []
      : [
          {
            old_string: oldContent,
            new_string: newContent,
            replace_all: false,
          },
        ];
  const noChangesMessage = !fileExists ? 'File does not exist' : 'Pattern did not match any content';
  const parseInput = (input: unknown) => {
    const parsed = BashTool.inputSchema.parse(input);
    return {
      ...parsed,
      _simulatedSedEdit: {
        filePath,
        newContent,
      },
    };
  };
  return (
    <FilePermissionDialog
      toolUseConfirm={props.toolUseConfirm}
      toolUseContext={props.toolUseContext}
      onDone={props.onDone}
      onReject={props.onReject}
      title="Edit file"
      subtitle={relative(getCwd(), filePath)}
      question={
        <Text>
          Do you want to make this edit to{' '}
          <Text bold={true}>{basename(filePath)}</Text>?
        </Text>
      }
      content={
        edits.length > 0 ? (
          <FileEditToolDiff file_path={filePath} edits={edits} />
        ) : (
          <Text dimColor={true}>{noChangesMessage}</Text>
        )
      }
      path={filePath}
      completionType="str_replace_single"
      parseInput={parseInput}
      workerBadge={props.workerBadge}
    />
  );
}
