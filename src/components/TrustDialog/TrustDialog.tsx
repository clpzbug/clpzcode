import { homedir } from 'os';
import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { setSessionTrustAccepted } from '../../bootstrap/state.js';
import type { Command } from '../../commands.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Link, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getMcpConfigsByScope } from '../../services/mcp/config.js';
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js';
import { checkHasTrustDialogAccepted, saveCurrentProjectConfig } from '../../utils/config.js';
import { getCwd } from '../../utils/cwd.js';
import { getFsImplementation } from '../../utils/fsOperations.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { Select } from '../CustomSelect/index.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
import { getApiKeyHelperSources, getAwsCommandsSources, getBashPermissionSources, getDangerousEnvVarsSources, getGcpCommandsSources, getHooksSources, getOtelHeadersHelperSources } from './utils.js';
type Props = {
  onDone(): void;
  commands?: Command[];
};

function hasBashTool(tool: string): boolean {
  return tool === BASH_TOOL_NAME || tool.startsWith(BASH_TOOL_NAME + "(");
}

function isDeprecatedBashCommand(command: Command): boolean {
  return command.type === "prompt" && command.loadedFrom === "commands_DEPRECATED" && (command.source === "projectSettings" || command.source === "localSettings") && (command.allowedTools?.some(hasBashTool) ?? false);
}

function isSkillBashCommand(command: Command): boolean {
  return command.type === "prompt" && (command.loadedFrom === "skills" || command.loadedFrom === "plugin") && (command.source === "projectSettings" || command.source === "localSettings" || command.source === "plugin") && (command.allowedTools?.some(hasBashTool) ?? false);
}

export function TrustDialog({ onDone, commands }: Props) {
  const { servers: projectServers } = getMcpConfigsByScope("project");
  const hasMcpServers = Object.keys(projectServers).length > 0;
  const hooksSettingSources = getHooksSources();
  const hasHooks = hooksSettingSources.length > 0;
  const bashSettingSources = getBashPermissionSources();
  const apiKeyHelperSources = getApiKeyHelperSources();
  const hasApiKeyHelper = apiKeyHelperSources.length > 0;
  const awsCommandsSources = getAwsCommandsSources();
  const hasAwsCommands = awsCommandsSources.length > 0;
  const gcpCommandsSources = getGcpCommandsSources();
  const hasGcpCommands = gcpCommandsSources.length > 0;
  const otelHeadersHelperSources = getOtelHeadersHelperSources();
  const hasOtelHeadersHelper = otelHeadersHelperSources.length > 0;
  const dangerousEnvVarsSources = getDangerousEnvVarsSources();
  const hasDangerousEnvVars = dangerousEnvVarsSources.length > 0;
  const hasSlashCommandBash = commands?.some(isDeprecatedBashCommand) ?? false;
  const hasSkillsBash = commands?.some(isSkillBashCommand) ?? false;
  const hasAnyBashExecution = bashSettingSources.length > 0 || hasSlashCommandBash || hasSkillsBash;
  const hasTrustDialogAccepted = checkHasTrustDialogAccepted();
  React.useEffect(() => {
    const isHomeDir = homedir() === getCwd();
    logEvent("tengu_trust_dialog_shown", {
      isHomeDir,
      hasMcpServers,
      hasHooks,
      hasBashExecution: hasAnyBashExecution,
      hasApiKeyHelper,
      hasAwsCommands,
      hasGcpCommands,
      hasOtelHeadersHelper,
      hasDangerousEnvVars
    });
  }, [hasMcpServers, hasHooks, hasAnyBashExecution, hasApiKeyHelper, hasAwsCommands, hasGcpCommands, hasOtelHeadersHelper, hasDangerousEnvVars]);
  const onChange = function onChange(value: 'enable_all' | 'exit') {
    if (value === "exit") {
      gracefulShutdownSync(1);
      return;
    }
    const isHomeDir = homedir() === getCwd();
    logEvent("tengu_trust_dialog_accept", {
      isHomeDir,
      hasMcpServers,
      hasHooks,
      hasBashExecution: hasAnyBashExecution,
      hasApiKeyHelper,
      hasAwsCommands,
      hasGcpCommands,
      hasOtelHeadersHelper,
      hasDangerousEnvVars
    });
    if (isHomeDir) {
      setSessionTrustAccepted(true);
    } else {
      saveCurrentProjectConfig(current => ({
        ...current,
        hasTrustDialogAccepted: true
      }));
    }
    onDone();
  };
  const exitState = useExitOnCtrlCDWithKeybindings(() => gracefulShutdownSync(1));
  useKeybinding("confirm:no", () => {
    gracefulShutdownSync(0);
  }, {
    context: "Confirmation"
  });
  if (hasTrustDialogAccepted) {
    setTimeout(onDone);
    return null;
  }
  return <PermissionDialog color="warning" titleColor="warning" title="Accessing workspace:"><Box flexDirection="column" gap={1} paddingTop={1}><Text bold={true}>{getFsImplementation().cwd()}</Text><Text>Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what{"'"}s in this folder first.</Text><Text>clpzcode{"'"}ll be able to read, edit, and execute files here.</Text><Text dimColor={true}><Link url="https://code.claude.com/docs/en/security">Security guide</Link></Text><Select options={[{
    label: "Yes, I trust this folder",
    value: "enable_all"
  }, {
    label: "No, exit",
    value: "exit"
  }]} onChange={value => onChange(value as 'enable_all' | 'exit')} onCancel={() => onChange("exit")} /><Text dimColor={true}>{exitState.pending ? <>Press {exitState.keyName} again to exit</> : <>Enter to confirm · Esc to cancel</>}</Text></Box></PermissionDialog>;
}
