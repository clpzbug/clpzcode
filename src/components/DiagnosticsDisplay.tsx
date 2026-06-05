import { relative } from 'path';
import React from 'react';
import { Box, Text } from '../ink.js';
import { DiagnosticTrackingService } from '../services/diagnosticTracking.js';
import type { Attachment } from '../utils/attachments.js';
import { getCwd } from '../utils/cwd.js';
import { CtrlOToExpand } from './CtrlOToExpand.js';
import { MessageResponse } from './MessageResponse.js';
type DiagnosticsAttachment = Extract<Attachment, {
  type: 'diagnostics';
}>;
type DiagnosticsDisplayProps = {
  attachment: DiagnosticsAttachment;
  verbose: boolean;
};
export function DiagnosticsDisplay({
  attachment,
  verbose
}: DiagnosticsDisplayProps) {
  if (attachment.files.length === 0) {
    return null;
  }
  const totalIssues = attachment.files.reduce(_temp, 0);
  const fileCount = attachment.files.length;
  if (verbose) {
    return <Box flexDirection="column">{attachment.files.map(_temp3)}</Box>;
  } else {
    return <MessageResponse><Text dimColor={true} wrap="wrap">Found {<Text bold={true}>{totalIssues}</Text>} new diagnostic{" "}{totalIssues === 1 ? "issue" : "issues"} in {fileCount}{" "}{fileCount === 1 ? "file" : "files"} {<CtrlOToExpand />}</Text></MessageResponse>;
  }
}
function _temp3(file_0, fileIndex) {
  return <React.Fragment key={fileIndex}><MessageResponse><Text dimColor={true} wrap="wrap"><Text bold={true}>{relative(getCwd(), file_0.uri.replace("file://", "").replace("_claude_fs_right:", ""))}</Text>{" "}<Text dimColor={true}>{file_0.uri.startsWith("file://") ? "(file://)" : file_0.uri.startsWith("_claude_fs_right:") ? "(claude_fs_right)" : `(${file_0.uri.split(":")[0]})`}</Text>:</Text></MessageResponse>{file_0.diagnostics.map(_temp2)}</React.Fragment>;
}
function _temp2(diagnostic, diagIndex) {
  return <MessageResponse key={diagIndex}><Text dimColor={true} wrap="wrap">{"  "}{DiagnosticTrackingService.getSeveritySymbol(diagnostic.severity)}{" [Line "}{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}{"] "}{diagnostic.message}{diagnostic.code ? ` [${diagnostic.code}]` : ""}{diagnostic.source ? ` (${diagnostic.source})` : ""}</Text></MessageResponse>;
}
function _temp(sum, file) {
  return sum + file.diagnostics.length;
}
