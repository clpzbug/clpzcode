import React, { type ReactNode } from 'react';
import { Box } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
import { isAutoMemoryEnabled } from '../../../../memdir/paths.js';
import { type AgentMemoryScope, loadAgentMemoryPrompt } from '../../../../tools/AgentTool/agentMemory.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Select } from '../../../CustomSelect/select.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import type { AgentWizardData } from '../types.js';

type MemoryOption = {
  label: string;
  value: AgentMemoryScope | 'none';
};

export function MemoryStep() {
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();

  useKeybinding("confirm:no", goBack, { context: "Confirmation" });

  const isUserScope = wizardData.location === "userSettings";

  const memoryOptions: MemoryOption[] = isUserScope ? [{
    label: "User scope (~/.claude/agent-memory/) (Recommended)",
    value: "user"
  }, {
    label: "None (no persistent memory)",
    value: "none"
  }, {
    label: "Project scope (.claude/agent-memory/)",
    value: "project"
  }, {
    label: "Local scope (.claude/agent-memory-local/)",
    value: "local"
  }] : [{
    label: "Project scope (.claude/agent-memory/) (Recommended)",
    value: "project"
  }, {
    label: "None (no persistent memory)",
    value: "none"
  }, {
    label: "User scope (~/.claude/agent-memory/)",
    value: "user"
  }, {
    label: "Local scope (.claude/agent-memory-local/)",
    value: "local"
  }];

  const handleSelect = (value: AgentMemoryScope | 'none') => {
    const memory = value === "none" ? undefined : value as AgentMemoryScope;
    const agentType = wizardData.finalAgent?.agentType;
    updateWizardData({
      selectedMemory: memory,
      finalAgent: wizardData.finalAgent ? {
        ...wizardData.finalAgent,
        memory,
        getSystemPrompt: isAutoMemoryEnabled() && memory && agentType ? () => wizardData.systemPrompt + "\n\n" + loadAgentMemoryPrompt(agentType, memory) : () => wizardData.systemPrompt
      } : undefined
    });
    goNext();
  };

  const footer: ReactNode = <Byline><KeyboardShortcutHint shortcut={"↑↓"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" /></Byline>;

  return <WizardDialogLayout subtitle="Configure agent memory" footerText={footer}><Box><Select key="memory-select" options={memoryOptions} onChange={handleSelect} onCancel={goBack} /></Box></WizardDialogLayout>;
}
