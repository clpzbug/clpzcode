import * as React from 'react';
import BashToolResultMessage from '../../tools/BashTool/BashToolResultMessage.js';
import { extractTag } from '../../utils/messages.js';

type Props = {
  content: string;
  verbose: boolean;
};

export function UserBashOutputMessage({ content, verbose }: Props) {
  const rawStdout = extractTag(content, "bash-stdout") ?? "";
  const stdout = extractTag(rawStdout, "persisted-output") ?? rawStdout;
  const stderr = extractTag(content, "bash-stderr") ?? "";
  return (
    <BashToolResultMessage content={{ stdout, stderr }} verbose={!!verbose} />
  );
}
