import figures from 'figures';
import React, { useState } from 'react';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import TextInput from './TextInput.js';
type Props = {
  initialLanguage: string | undefined;
  onComplete: (language: string | undefined) => void;
  onCancel: () => void;
};
export function LanguagePicker({ initialLanguage, onComplete, onCancel }: Props) {
  const [language, setLanguage] = useState(initialLanguage);
  const [cursorOffset, setCursorOffset] = useState((initialLanguage ?? "").length);
  useKeybinding("confirm:no", onCancel, { context: "Settings" });
  const handleSubmit = function handleSubmit() {
    const trimmed = language?.trim();
    onComplete(trimmed || undefined);
  };
  const value = language ?? "";
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Enter your preferred response and voice language:</Text>
      <Box flexDirection="row" gap={1}>
        <Text>{figures.pointer}</Text>
        <TextInput value={value} onChange={setLanguage} onSubmit={handleSubmit} focus={true} showCursor={true} placeholder={`e.g., Japanese, 日本語, Español${figures.ellipsis}`} columns={60} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} />
      </Box>
      <Text dimColor={true}>Leave empty for default (English)</Text>
    </Box>
  );
}
