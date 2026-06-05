import React, { type ReactNode, useCallback, useState } from 'react';
import { Box, Text } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
import { editPromptInEditor } from '../../../../utils/promptEditor.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import TextInput from '../../../TextInput.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import type { AgentWizardData } from '../types.js';

export function PromptStep() {
  const { goNext, goBack, updateWizardData, wizardData } = useWizard();
  const [systemPrompt, setSystemPrompt] = useState(wizardData.systemPrompt || "");
  const [cursorOffset, setCursorOffset] = useState(systemPrompt.length);
  const [error, setError] = useState<string | null>(null);

  useKeybinding("confirm:no", goBack, { context: "Settings" });

  const handleExternalEditor = useCallback(async () => {
    const result = await editPromptInEditor(systemPrompt);
    if (result.content !== null) {
      setSystemPrompt(result.content);
      setCursorOffset(result.content.length);
    }
  }, [systemPrompt]);

  useKeybinding("chat:externalEditor", handleExternalEditor, { context: "Chat" });

  const handleSubmit = useCallback(() => {
    const trimmedPrompt = systemPrompt.trim();
    if (!trimmedPrompt) {
      setError("System prompt is required");
      return;
    }
    setError(null);
    updateWizardData({
      systemPrompt: trimmedPrompt
    });
    goNext();
  }, [goNext, systemPrompt, updateWizardData]);

  const footerText = (
    <Byline>
      <KeyboardShortcutHint shortcut="Type" action="enter text" />
      <KeyboardShortcutHint shortcut="Enter" action="continue" />
      <ConfigurableShortcutHint action="chat:externalEditor" context="Chat" fallback="ctrl+g" description="open in editor" />
      <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="go back" />
    </Byline>
  );

  return (
    <WizardDialogLayout subtitle="System prompt" footerText={footerText}>
      <Box flexDirection="column">
        <Text>Enter the system prompt for your agent:</Text>
        <Text dimColor={true}>Be comprehensive for best results</Text>
        <Box marginTop={1}>
          <TextInput
            value={systemPrompt}
            onChange={setSystemPrompt}
            onSubmit={handleSubmit}
            placeholder="You are a helpful code reviewer who..."
            columns={80}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            focus={true}
            showCursor={true}
          />
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color="error">{error}</Text>
          </Box>
        )}
      </Box>
    </WizardDialogLayout>
  );
}
