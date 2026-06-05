import React, { useCallback, useState } from 'react';
import TextInput from '../../components/TextInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, color, Text, useTheme } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
interface ApiKeyStepProps {
  existingApiKey: string | null;
  useExistingKey: boolean;
  apiKeyOrOAuthToken: string;
  onApiKeyChange: (value: string) => void;
  onToggleUseExistingKey: (useExisting: boolean) => void;
  onSubmit: () => void;
  onCreateOAuthToken?: () => void;
  selectedOption?: 'existing' | 'new' | 'oauth';
  onSelectOption?: (option: 'existing' | 'new' | 'oauth') => void;
}
export function ApiKeyStep({
  existingApiKey,
  apiKeyOrOAuthToken,
  onApiKeyChange,
  onSubmit,
  onToggleUseExistingKey,
  onCreateOAuthToken,
  selectedOption: selectedOptionProp,
  onSelectOption
}: ApiKeyStepProps) {
  const selectedOption = selectedOptionProp === undefined ? (existingApiKey ? "existing" : onCreateOAuthToken ? "oauth" : "new") : selectedOptionProp;
  const [cursorOffset, setCursorOffset] = useState(0);
  const terminalSize = useTerminalSize();
  const [theme] = useTheme();

  const handlePrevious = useCallback(() => {
    if (selectedOption === "new" && onCreateOAuthToken) {
      onSelectOption?.("oauth");
    } else {
      if (selectedOption === "oauth" && existingApiKey) {
        onSelectOption?.("existing");
        onToggleUseExistingKey(true);
      }
    }
  }, [existingApiKey, onCreateOAuthToken, onSelectOption, onToggleUseExistingKey, selectedOption]);

  const handleNext = useCallback(() => {
    if (selectedOption === "existing") {
      onSelectOption?.(onCreateOAuthToken ? "oauth" : "new");
      onToggleUseExistingKey(false);
    } else {
      if (selectedOption === "oauth") {
        onSelectOption?.("new");
      }
    }
  }, [onCreateOAuthToken, onSelectOption, onToggleUseExistingKey, selectedOption]);

  const handleConfirm = useCallback(() => {
    if (selectedOption === "oauth" && onCreateOAuthToken) {
      onCreateOAuthToken();
    } else {
      onSubmit();
    }
  }, [onCreateOAuthToken, onSubmit, selectedOption]);

  const isTextInputVisible = selectedOption === "new";

  useKeybindings({
    "confirm:previous": handlePrevious,
    "confirm:next": handleNext,
    "confirm:yes": handleConfirm
  }, {
    context: "Confirmation",
    isActive: !isTextInputVisible
  });

  useKeybindings({
    "confirm:previous": handlePrevious,
    "confirm:next": handleNext
  }, {
    context: "Confirmation",
    isActive: isTextInputVisible
  });

  return <>
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold={true}>Install GitHub App</Text>
        <Text dimColor={true}>Choose API key</Text>
      </Box>
      {existingApiKey && <Box marginBottom={1}><Text>{selectedOption === "existing" ? color("success", theme)("> ") : "  "}Use your existing Claude Code API key</Text></Box>}
      {onCreateOAuthToken && <Box marginBottom={1}><Text>{selectedOption === "oauth" ? color("success", theme)("> ") : "  "}Create a long-lived token with your Claude subscription</Text></Box>}
      <Box marginBottom={1}><Text>{selectedOption === "new" ? color("success", theme)("> ") : "  "}Enter a new API key</Text></Box>
      {selectedOption === "new" && <TextInput value={apiKeyOrOAuthToken} onChange={onApiKeyChange} onSubmit={onSubmit} onPaste={onApiKeyChange} focus={true} placeholder={"sk-ant… (Create a new key at https://platform.claude.com/settings/keys)"} mask="*" columns={terminalSize.columns} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} showCursor={true} />}
    </Box>
    <Box marginLeft={3}><Text dimColor={true}>↑/↓ to select · Enter to continue</Text></Box>
  </>;
}
