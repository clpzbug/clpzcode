import { basename, relative } from 'path';
import React from 'react';
import { Box, Text } from '../ink.js';
import { getCwd } from '../utils/cwd.js';
import { isSupportedVSCodeTerminal } from '../utils/ide.js';
import { Select } from './CustomSelect/index.js';
import { Pane } from './design-system/Pane.js';
import type { PermissionOption, PermissionOptionWithLabel } from './permissions/FilePermissionDialog/permissionOptions.js';
type Props<A> = {
  filePath: string;
  input: A;
  onChange: (option: PermissionOption, args: A, feedback?: string) => void;
  options: PermissionOptionWithLabel[];
  ideName: string;
  symlinkTarget?: string | null;
  rejectFeedback: string;
  acceptFeedback: string;
  setFocusedOption: (value: string) => void;
  onInputModeToggle: (value: string) => void;
  focusedOption: string;
  yesInputMode: boolean;
  noInputMode: boolean;
};
export function ShowInIDEPrompt<A>({
  onChange,
  options,
  input,
  filePath,
  ideName,
  symlinkTarget,
  rejectFeedback,
  acceptFeedback,
  setFocusedOption,
  onInputModeToggle,
  focusedOption,
  yesInputMode,
  noInputMode
}: Props<A>) {
  const fileName = basename(filePath);
  const onSelectChange = (value: string) => {
    const selected = options.find(opt => opt.value === value);
    if (selected) {
      if (selected.option.type === "reject") {
        const trimmedFeedback = rejectFeedback.trim();
        onChange(selected.option, input, trimmedFeedback || undefined);
        return;
      }
      if (selected.option.type === "accept-once") {
        const trimmedFeedback = acceptFeedback.trim();
        onChange(selected.option, input, trimmedFeedback || undefined);
        return;
      }
      onChange(selected.option, input);
    }
  };
  const onCancel = () => onChange({
    type: "reject"
  }, input);
  const onFocus = (value: string) => setFocusedOption(value);
  const amendHint = (focusedOption === "yes" && !yesInputMode || focusedOption === "no" && !noInputMode) && " \xB7 Tab to amend";
  return <Pane color="permission"><Box flexDirection="column" gap={1}><Text bold={true} color="permission">Opened changes in {ideName} ⧉</Text>{symlinkTarget && <Text color="warning">{relative(getCwd(), symlinkTarget).startsWith("..") ? `This will modify ${symlinkTarget} (outside working directory) via a symlink` : `Symlink target: ${symlinkTarget}`}</Text>}{isSupportedVSCodeTerminal() && <Text dimColor={true}>Save file to continue…</Text>}<Box flexDirection="column"><Text>Do you want to make this edit to{" "}<Text bold={true}>{fileName}</Text>?</Text><Select options={options} inlineDescriptions={true} onChange={onSelectChange} onCancel={onCancel} onFocus={onFocus} onInputModeToggle={onInputModeToggle} /></Box><Box marginTop={1}><Text dimColor={true}>Esc to cancel{amendHint}</Text></Box></Box></Pane>;
}
