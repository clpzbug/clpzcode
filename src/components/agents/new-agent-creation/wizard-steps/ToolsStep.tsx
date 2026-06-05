import React from 'react';
import type { Tools } from '../../../../Tool.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { ToolSelector } from '../../ToolSelector.js';
import type { AgentWizardData } from '../types.js';
type Props = {
  tools: Tools;
};
export function ToolsStep({ tools }: Props) {
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();
  const handleComplete = (selectedTools: AgentWizardData['selectedTools']) => {
    updateWizardData({
      selectedTools
    });
    goNext();
  };
  const initialTools = wizardData.selectedTools;
  const footerText = <Byline><KeyboardShortcutHint shortcut="Enter" action="toggle selection" /><KeyboardShortcutHint shortcut={"\u2191\u2193"} action="navigate" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" /></Byline>;
  return <WizardDialogLayout subtitle="Select tools" footerText={footerText}><ToolSelector tools={tools} initialTools={initialTools} onComplete={handleComplete} onCancel={goBack} /></WizardDialogLayout>;
}
