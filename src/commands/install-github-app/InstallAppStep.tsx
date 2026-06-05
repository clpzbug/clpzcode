import figures from 'figures';
import React from 'react';
import { GITHUB_ACTION_SETUP_DOCS_URL } from '../../constants/github-app.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
interface InstallAppStepProps {
  repoUrl: string;
  onSubmit: () => void;
}
export function InstallAppStep({ repoUrl, onSubmit }: InstallAppStepProps) {
  useKeybinding("confirm:yes", onSubmit, { context: "Confirmation" });
  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1}>
      <Box flexDirection="column" marginBottom={1}><Text bold={true}>Install the Claude GitHub App</Text></Box>
      <Box marginBottom={1}><Text>Opening browser to install the Claude GitHub App…</Text></Box>
      <Box marginBottom={1}><Text>If your browser doesn't open automatically, visit:</Text></Box>
      <Box marginBottom={1}><Text underline={true}>https://github.com/apps/claude</Text></Box>
      <Box marginBottom={1}><Text>Please install the app for repository: <Text bold={true}>{repoUrl}</Text></Text></Box>
      <Box marginBottom={1}><Text dimColor={true}>Important: Make sure to grant access to this specific repository</Text></Box>
      <Box><Text bold={true} color="permission">Press Enter once you've installed the app{figures.ellipsis}</Text></Box>
      <Box marginTop={1}><Text dimColor={true}>Having trouble? See manual setup instructions at:{" "}<Text color="claude">{GITHUB_ACTION_SETUP_DOCS_URL}</Text></Text></Box>
    </Box>
  );
}
