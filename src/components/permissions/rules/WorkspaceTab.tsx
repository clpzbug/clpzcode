import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { getOriginalCwd } from '../../../bootstrap/state.js';
import type { CommandResultDisplay } from '../../../commands.js';
import { Select } from '../../../components/CustomSelect/select.js';
import { Box, Text } from '../../../ink.js';
import type { ToolPermissionContext } from '../../../Tool.js';
import { useTabHeaderFocus } from '../../design-system/Tabs.js';
type Props = {
  onExit: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  toolPermissionContext: ToolPermissionContext;
  onRequestAddDirectory: () => void;
  onRequestRemoveDirectory: (path: string) => void;
  onHeaderFocusChange?: (focused: boolean) => void;
};
type DirectoryItem = {
  path: string;
  isCurrent: boolean;
  isDeletable: boolean;
};
export function WorkspaceTab({
  onExit,
  toolPermissionContext,
  onRequestAddDirectory,
  onRequestRemoveDirectory,
  onHeaderFocusChange
}: Props) {
  const {
    headerFocused,
    focusHeader
  } = useTabHeaderFocus();
  useEffect(() => {
    onHeaderFocusChange?.(headerFocused);
  }, [headerFocused, onHeaderFocusChange]);
  const directoryPaths = Array.from((toolPermissionContext.additionalWorkingDirectories as Map<string, any>).keys()) as string[];
  const additionalDirectories: DirectoryItem[] = directoryPaths.map(path => ({
    path,
    isCurrent: false,
    isDeletable: true
  }));
  const handleDirectorySelect = (selectedValue: string) => {
    if (selectedValue === "add-directory") {
      onRequestAddDirectory();
      return;
    }
    const directory = additionalDirectories.find(d => d.path === selectedValue);
    if (directory && directory.isDeletable) {
      onRequestRemoveDirectory(directory.path);
    }
  };
  const handleCancel = () => onExit("Workspace dialog dismissed", {
    display: "system"
  });
  const options = additionalDirectories.map(dir => ({
    label: dir.path,
    value: dir.path
  }));
  options.push({
    label: `Add directory${figures.ellipsis}`,
    value: "add-directory"
  });
  return <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" marginTop={1} marginLeft={2} gap={1}><Text>{`-  ${getOriginalCwd()}`}</Text><Text dimColor={true}>(Original working directory)</Text></Box>
      <Select options={options} onChange={handleDirectorySelect} onCancel={handleCancel} visibleOptionCount={Math.min(10, options.length)} onUpFromFirstItem={focusHeader} isDisabled={headerFocused} />
    </Box>;
}
