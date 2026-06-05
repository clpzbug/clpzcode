import React from 'react';
import { Text } from '../ink.js';
import type { ValidationError } from '../utils/settings/validation.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { ValidationErrorsList } from './ValidationErrorsList.js';
type Props = {
  settingsErrors: ValidationError[];
  onContinue: () => void;
  onExit: () => void;
};

/**
 * Dialog shown when settings files have validation errors.
 * User must choose to continue (skipping invalid files) or exit to fix them.
 */
export function InvalidSettingsDialog({ settingsErrors, onContinue, onExit }: Props) {
  function handleSelect(value: string) {
    if (value === "exit") {
      onExit();
    } else {
      onContinue();
    }
  }

  const options = [{
    label: "Exit and fix manually",
    value: "exit"
  }, {
    label: "Continue without these settings",
    value: "continue"
  }];

  return (
    <Dialog title="Settings Error" onCancel={onExit} color="warning">
      <ValidationErrorsList errors={settingsErrors} />
      <Text dimColor={true}>Files with errors are skipped entirely, not just the invalid settings.</Text>
      <Select options={options} onChange={handleSelect} />
    </Dialog>
  );
}
