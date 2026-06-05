import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { PromptRequest } from '../../types/hooks.js';
import { Select } from '../CustomSelect/select.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
type Props = {
  title: string;
  toolInputSummary?: string | null;
  request: PromptRequest;
  onRespond: (key: string) => void;
  onAbort: () => void;
};
export function PromptDialog({ title, toolInputSummary, request, onRespond, onAbort }: Props) {
  useKeybinding("app:interrupt", onAbort, { isActive: true });
  const options = request.options.map(opt => ({
    label: opt.label,
    value: opt.key,
    description: opt.description
  }));
  const titleRight = toolInputSummary ? <Text dimColor={true}>{toolInputSummary}</Text> : undefined;
  return (
    <PermissionDialog title={title} subtitle={request.message} titleRight={titleRight}>
      <Box flexDirection="column" paddingY={1}>
        <Select options={options} onChange={value => {
          onRespond(value);
        }} />
      </Box>
    </PermissionDialog>
  );
}
