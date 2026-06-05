import { basename, relative } from 'path';
import React from 'react';
import type { z } from 'zod/v4';
import { Text } from '../../../ink.js';
import { FileWriteTool } from '../../../tools/FileWriteTool/FileWriteTool.js';
import { getCwd } from '../../../utils/cwd.js';
import { isENOENT } from '../../../utils/errors.js';
import { readFileSync } from '../../../utils/fileRead.js';
import { FilePermissionDialog } from '../FilePermissionDialog/FilePermissionDialog.js';
import { createSingleEditDiffConfig, type FileEdit, type IDEDiffSupport } from '../FilePermissionDialog/ideDiffConfig.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { FileWriteToolDiff } from './FileWriteToolDiff.js';
type FileWriteToolInput = z.infer<typeof FileWriteTool.inputSchema>;
const ideDiffSupport: IDEDiffSupport<FileWriteToolInput> = {
  getConfig: (input: FileWriteToolInput) => {
    let oldContent: string;
    try {
      oldContent = readFileSync(input.file_path);
    } catch (e) {
      if (!isENOENT(e)) throw e;
      oldContent = '';
    }
    return createSingleEditDiffConfig(input.file_path, oldContent, input.content, false // For file writes, we replace the entire content
    );
  },
  applyChanges: (input: FileWriteToolInput, modifiedEdits: FileEdit[]) => {
    const firstEdit = modifiedEdits[0];
    if (firstEdit) {
      return {
        ...input,
        content: firstEdit.new_string
      };
    }
    return input;
  }
};
function parseInput(input: unknown): FileWriteToolInput {
  return FileWriteTool.inputSchema.parse(input);
}
export function FileWritePermissionRequest(props: PermissionRequestProps) {
  const parsed = parseInput(props.toolUseConfirm.input);
  const { file_path, content } = parsed;

  let fileExists: boolean;
  let oldContent: string;
  try {
    oldContent = readFileSync(file_path);
    fileExists = true;
  } catch (e) {
    if (!isENOENT(e)) {
      throw e;
    }
    fileExists = false;
    oldContent = '';
  }

  const actionText = fileExists ? 'overwrite' : 'create';
  const title = fileExists ? 'Overwrite file' : 'Create file';
  const subtitle = relative(getCwd(), file_path);
  const fileName = basename(file_path);

  return (
    <FilePermissionDialog
      toolUseConfirm={props.toolUseConfirm}
      toolUseContext={props.toolUseContext}
      onDone={props.onDone}
      onReject={props.onReject}
      workerBadge={props.workerBadge}
      title={title}
      subtitle={subtitle}
      question={<Text>Do you want to {actionText} <Text bold={true}>{fileName}</Text>?</Text>}
      content={<FileWriteToolDiff file_path={file_path} content={content} fileExists={fileExists} oldContent={oldContent} />}
      path={file_path}
      completionType="write_file_single"
      parseInput={parseInput}
      ideDiffSupport={ideDiffSupport}
    />
  );
}
