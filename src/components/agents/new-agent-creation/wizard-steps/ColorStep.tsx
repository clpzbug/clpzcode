import React from 'react';
import { Box } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
import type { AgentColorName } from '../../../../tools/AgentTool/agentColorManager.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { ColorPicker } from '../../ColorPicker.js';

export function ColorStep() {
  const { goNext, goBack, updateWizardData, wizardData } = useWizard();

  useKeybinding("confirm:no", goBack, { context: "Confirmation" });

  const handleConfirm = (color: AgentColorName | undefined) => {
    updateWizardData({
      selectedColor: color,
      finalAgent: {
        agentType: wizardData.agentType,
        whenToUse: wizardData.whenToUse,
        getSystemPrompt: () => wizardData.systemPrompt,
        tools: wizardData.selectedTools,
        ...(wizardData.selectedModel ? {
          model: wizardData.selectedModel
        } : {}),
        ...(color ? {
          color: color as AgentColorName
        } : {}),
        source: wizardData.location
      }
    });
    goNext();
  };

  const footer = (
    <Byline>
      <KeyboardShortcutHint shortcut={"↑↓"} action="navigate" />
      <KeyboardShortcutHint shortcut="Enter" action="select" />
      <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
    </Byline>
  );

  const agentName = wizardData.agentType || "agent";

  return (
    <WizardDialogLayout subtitle="Choose background color" footerText={footer}>
      <Box>
        <ColorPicker agentName={agentName} currentColor="automatic" onConfirm={handleConfirm} />
      </Box>
    </WizardDialogLayout>
  );
}
