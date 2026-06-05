import React, { useCallback, useState } from 'react';
import type { Workflow } from '../commands/install-github-app/types.js';
import type { ExitState } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Link, Text } from '../ink.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { SelectMulti } from './CustomSelect/SelectMulti.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
type WorkflowOption = {
  value: Workflow;
  label: string;
};
type Props = {
  onSubmit: (selectedWorkflows: Workflow[]) => void;
  defaultSelections: Workflow[];
};
const WORKFLOWS: WorkflowOption[] = [{
  value: 'claude' as const,
  label: '@Claude Code - Tag @claude in issues and PR comments'
}, {
  value: 'claude-review' as const,
  label: 'Claude Code Review - Automated code review on new PRs'
}];
function renderInputGuide(exitState: ExitState): React.ReactNode {
  if (exitState.pending) {
    return <Text>Press {exitState.keyName} again to exit</Text>;
  }
  return <Byline>
      <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
      <KeyboardShortcutHint shortcut="Space" action="toggle" />
      <KeyboardShortcutHint shortcut="Enter" action="confirm" />
      <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
    </Byline>;
}
export function WorkflowMultiselectDialog({
  onSubmit,
  defaultSelections
}: Props) {
  const [showError, setShowError] = useState(false);
  const handleSubmit = useCallback((selectedValues: Workflow[]) => {
    if (selectedValues.length === 0) {
      setShowError(true);
      return;
    }
    setShowError(false);
    onSubmit(selectedValues);
  }, [onSubmit]);
  const handleChange = () => {
    setShowError(false);
  };
  const handleCancel = () => {
    setShowError(true);
  };
  const options = WORKFLOWS.map(_temp);
  return <Dialog title="Select GitHub workflows to install" subtitle="We'll create a workflow file in your repository for each one you select." onCancel={handleCancel} inputGuide={renderInputGuide}><Box><Text dimColor={true}>More workflow examples (issue triage, CI fixes, etc.) at:{" "}<Link url="https://github.com/anthropics/claude-code-action/blob/main/examples/">https://github.com/anthropics/claude-code-action/blob/main/examples/</Link></Text></Box><SelectMulti options={options} defaultValue={defaultSelections} onSubmit={handleSubmit} onChange={handleChange} onCancel={handleCancel} hideIndexes={true} />{showError && <Box><Text color="error">You must select at least one workflow to continue</Text></Box>}</Dialog>;
}
function _temp(workflow: WorkflowOption) {
  return {
    label: workflow.label,
    value: workflow.value
  };
}
