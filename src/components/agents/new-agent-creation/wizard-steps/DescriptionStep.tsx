import React, { type ReactNode, useCallback, useState } from 'react';
import { PRODUCT_DISPLAY_NAME } from '../../../../constants/product.js';
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

export function DescriptionStep() {
  const { goNext, goBack, updateWizardData, wizardData } = useWizard();
  const [whenToUse, setWhenToUse] = useState(wizardData.whenToUse || "");
  const [cursorOffset, setCursorOffset] = useState(whenToUse.length);
  const [error, setError] = useState<string | null>(null);

  useKeybinding("confirm:no", goBack, { context: "Settings" });

  const handleExternalEditor = useCallback(async () => {
    const result = await editPromptInEditor(whenToUse);
    if (result.content !== null) {
      setWhenToUse(result.content);
      setCursorOffset(result.content.length);
    }
  }, [whenToUse]);

  useKeybinding("chat:externalEditor", handleExternalEditor, { context: "Chat" });

  const handleSubmit = useCallback((value: string) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      setError("Description is required");
      return;
    }
    setError(null);
    updateWizardData({ whenToUse: trimmedValue });
    goNext();
  }, [goNext, updateWizardData]);

  return (
    <WizardDialogLayout
      subtitle={`Description (tell ${PRODUCT_DISPLAY_NAME} when to use this agent)`}
      footerText={
        <Byline>
          <KeyboardShortcutHint shortcut="Type" action="enter text" />
          <KeyboardShortcutHint shortcut="Enter" action="continue" />
          <ConfigurableShortcutHint action="chat:externalEditor" context="Chat" fallback="ctrl+g" description="open in editor" />
          <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="go back" />
        </Byline>
      }
    >
      <Box flexDirection="column">
        <Text>When should {PRODUCT_DISPLAY_NAME} use this agent?</Text>
        <Box marginTop={1}>
          <TextInput
            value={whenToUse}
            onChange={setWhenToUse}
            onSubmit={handleSubmit}
            placeholder="e.g., use this agent after you're done writing code..."
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
