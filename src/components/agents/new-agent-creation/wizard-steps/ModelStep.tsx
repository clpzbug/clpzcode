import React from 'react';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { ModelSelector } from '../../ModelSelector.js';
import type { AgentWizardData } from '../types.js';

export function ModelStep() {
  const { goNext, goBack, updateWizardData, wizardData } = useWizard();

  const handleComplete = (model: AgentWizardData['selectedModel']) => {
    updateWizardData({ selectedModel: model });
    goNext();
  };

  const footerText = (
    <Byline>
      <KeyboardShortcutHint shortcut={"↑↓"} action="navigate" />
      <KeyboardShortcutHint shortcut="Enter" action="select" />
      <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
    </Byline>
  );

  return (
    <WizardDialogLayout subtitle="Select model" footerText={footerText}>
      <ModelSelector initialModel={wizardData.selectedModel} onComplete={handleComplete} onCancel={goBack} />
    </WizardDialogLayout>
  );
}
