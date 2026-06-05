import figures from 'figures';
import { join } from 'path';
import React, { Suspense, use, useEffect, useMemo, useState } from 'react';
import { KeybindingWarnings } from 'src/components/KeybindingWarnings.js';
import { McpParsingWarnings } from 'src/components/mcp/McpParsingWarnings.js';
import { getModelMaxOutputTokens } from 'src/utils/context.js';
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js';
import type { SettingSource } from 'src/utils/settings/constants.js';
import { getOriginalCwd } from '../bootstrap/state.js';
import type { CommandResultDisplay } from '../commands.js';
import { Pane } from '../components/design-system/Pane.js';
import { PressEnterToContinue } from '../components/PressEnterToContinue.js';
import { SandboxDoctorSection } from '../components/sandbox/SandboxDoctorSection.js';
import { ValidationErrorsList } from '../components/ValidationErrorsList.js';
import { useSettingsErrors } from '../hooks/notifs/useSettingsErrors.js';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useAppState } from '../state/AppState.js';
import { getPluginErrorMessage } from '../types/plugin.js';
import { getGcsDistTags, getNpmDistTags, type NpmDistTags } from '../utils/autoUpdater.js';
import { type ContextWarnings, checkContextWarnings } from '../utils/doctorContextWarnings.js';
import { type DiagnosticInfo, getDoctorDiagnostic } from '../utils/doctorDiagnostic.js';
import { validateBoundedIntEnvVar } from '../utils/envValidation.js';
import { pathExists } from '../utils/file.js';
import { cleanupStaleLocks, getAllLockInfo, isPidBasedLockingEnabled, type LockInfo } from '../utils/nativeInstaller/pidLock.js';
import { getInitialSettings } from '../utils/settings/settings.js';
import { BASH_MAX_OUTPUT_DEFAULT, BASH_MAX_OUTPUT_UPPER_LIMIT } from '../utils/shell/outputLimits.js';
import { TASK_MAX_OUTPUT_DEFAULT, TASK_MAX_OUTPUT_UPPER_LIMIT } from '../utils/task/outputFormatting.js';
import { getXDGStateHome } from '../utils/xdg.js';
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
type AgentInfo = {
  activeAgents: Array<{
    agentType: string;
    source: SettingSource | 'built-in' | 'plugin';
  }>;
  userAgentsDir: string;
  projectAgentsDir: string;
  userDirExists: boolean;
  projectDirExists: boolean;
  failedFiles?: Array<{
    path: string;
    error: string;
  }>;
};
type VersionLockInfo = {
  enabled: boolean;
  locks: LockInfo[];
  locksDir: string;
  staleLocksCleaned: number;
};
function DistTagsDisplay({ promise }: { promise: Promise<NpmDistTags> }) {
  const distTags = use(promise);
  if (!distTags.latest) {
    return <Text dimColor={true}>└ Failed to fetch versions</Text>;
  }
  return <>{distTags.stable && <Text>└ Stable version: {distTags.stable}</Text>}<Text>└ Latest version: {distTags.latest}</Text></>;
}
export function Doctor({ onDone }: Props) {
  const agentDefinitions = useAppState(s => s.agentDefinitions);
  const mcpTools = useAppState(s => s.mcp.tools);
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const pluginsErrors = useAppState(s => s.plugins.errors);
  useExitOnCtrlCDWithKeybindings();
  const tools = mcpTools || [];
  const [diagnostic, setDiagnostic] = useState<DiagnosticInfo | null>(null);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [contextWarnings, setContextWarnings] = useState<ContextWarnings | null>(null);
  const [versionLockInfo, setVersionLockInfo] = useState<VersionLockInfo | null>(null);
  const validationErrors = useSettingsErrors();
  const distTagsPromise = useMemo(() => getDoctorDiagnostic().then(diag => {
    const fetchDistTags = diag.installationType === "native" ? getGcsDistTags : getNpmDistTags;
    return fetchDistTags().catch(() => ({
      latest: null,
      stable: null
    }));
  }), []);
  const autoUpdatesChannel = getInitialSettings()?.autoUpdatesChannel ?? "latest";
  const errorsExcludingMcp = validationErrors.filter(error => error.mcpErrorMetadata === undefined);
  const envValidationErrors = useMemo(() => {
    const envVars = [{
      name: "BASH_MAX_OUTPUT_LENGTH",
      default: BASH_MAX_OUTPUT_DEFAULT,
      upperLimit: BASH_MAX_OUTPUT_UPPER_LIMIT
    }, {
      name: "TASK_MAX_OUTPUT_LENGTH",
      default: TASK_MAX_OUTPUT_DEFAULT,
      upperLimit: TASK_MAX_OUTPUT_UPPER_LIMIT
    }, {
      name: "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
      ...getModelMaxOutputTokens("claude-opus-4-6")
    }];
    return envVars.map(v => {
      const value = process.env[v.name];
      const result = validateBoundedIntEnvVar(v.name, value, v.default, v.upperLimit);
      return {
        name: v.name,
        ...result
      };
    }).filter(v => v.status !== "valid");
  }, []);
  useEffect(() => {
    getDoctorDiagnostic().then(setDiagnostic);
    (async () => {
      const userAgentsDir = join(getClaudeConfigHomeDir(), "agents");
      const projectAgentsDir = join(getOriginalCwd(), ".claude", "agents");
      const {
        activeAgents,
        allAgents,
        failedFiles
      } = agentDefinitions;
      const [userDirExists, projectDirExists] = await Promise.all([pathExists(userAgentsDir), pathExists(projectAgentsDir)]);
      const agentInfoData = {
        activeAgents: activeAgents.map(a => ({
          agentType: a.agentType,
          source: a.source
        })),
        userAgentsDir,
        projectAgentsDir,
        userDirExists,
        projectDirExists,
        failedFiles
      };
      setAgentInfo(agentInfoData);
      const warnings = await checkContextWarnings(tools, {
        activeAgents,
        allAgents,
        failedFiles
      }, async () => toolPermissionContext);
      setContextWarnings(warnings);
      if (isPidBasedLockingEnabled()) {
        const locksDir = join(getXDGStateHome(), "claude", "locks");
        const staleLocksCleaned = cleanupStaleLocks(locksDir);
        const locks = getAllLockInfo(locksDir);
        setVersionLockInfo({
          enabled: true,
          locks,
          locksDir,
          staleLocksCleaned
        });
      } else {
        setVersionLockInfo({
          enabled: false,
          locks: [],
          locksDir: "",
          staleLocksCleaned: 0
        });
      }
    })();
  }, [toolPermissionContext, tools, agentDefinitions]);
  const handleDismiss = () => {
    onDone("clpzcode diagnostics dismissed", {
      display: "system"
    });
  };
  useKeybindings({
    "confirm:yes": handleDismiss,
    "confirm:no": handleDismiss
  }, {
    context: "Confirmation"
  });
  if (!diagnostic) {
    return <Pane><Text dimColor={true}>Checking installation status…</Text></Pane>;
  }
  const searchStatus = diagnostic.ripgrepStatus.working ? "OK" : "Not working";
  const searchMode = diagnostic.ripgrepStatus.mode === "embedded" ? "bundled" : diagnostic.ripgrepStatus.mode === "builtin" ? "vendor" : diagnostic.ripgrepStatus.systemPath || "system";
  const diagnosticsSection = <Box flexDirection="column"><Text bold={true}>Diagnostics</Text><Text>└ Currently running: {diagnostic.installationType} ({diagnostic.version})</Text>{diagnostic.packageManager && <Text>└ Package manager: {diagnostic.packageManager}</Text>}<Text>└ Path: {diagnostic.installationPath}</Text><Text>└ Invoked: {diagnostic.invokedBinary}</Text><Text>└ Config install method: {diagnostic.configInstallMethod}</Text><Text>└ Search: {searchStatus} ({searchMode})</Text>{diagnostic.recommendation && <><Text /><Text color="warning">Recommendation: {diagnostic.recommendation.split("\n")[0]}</Text><Text dimColor={true}>{diagnostic.recommendation.split("\n")[1]}</Text></>}{diagnostic.multipleInstallations.length > 1 && <><Text /><Text color="warning">Warning: Multiple installations found</Text>{diagnostic.multipleInstallations.map((install, i) => <Text key={i}>└ {install.type} at {install.path}</Text>)}</>}{diagnostic.warnings.length > 0 && <><Text />{diagnostic.warnings.map((warning, i_0) => <Box key={i_0} flexDirection="column"><Text color="warning">Warning: {warning.issue}</Text><Text>Fix: {warning.fix}</Text></Box>)}</>}{errorsExcludingMcp.length > 0 && <Box flexDirection="column" marginTop={1} marginBottom={1}><Text bold={true}>Invalid Settings</Text><ValidationErrorsList errors={errorsExcludingMcp} /></Box>}</Box>;
  const autoUpdatesValue = diagnostic.packageManager ? "Managed by package manager" : diagnostic.autoUpdates;
  const updatesSection = <Box flexDirection="column"><Text bold={true}>Updates</Text><Text>└ Auto-updates:{" "}{autoUpdatesValue}</Text>{diagnostic.hasUpdatePermissions !== null && <Text>└ Update permissions:{" "}{diagnostic.hasUpdatePermissions ? "Yes" : "No (requires sudo)"}</Text>}<Text>└ Auto-update channel: {autoUpdatesChannel}</Text><Suspense fallback={null}><DistTagsDisplay promise={distTagsPromise} /></Suspense></Box>;
  return <Pane>{diagnosticsSection}{updatesSection}<SandboxDoctorSection /><McpParsingWarnings /><KeybindingWarnings />{envValidationErrors.length > 0 && <Box flexDirection="column"><Text bold={true}>Environment Variables</Text>{envValidationErrors.map((validation, i_1) => <Text key={i_1}>└ {validation.name}:{" "}<Text color={validation.status === "capped" ? "warning" : "error"}>{validation.message}</Text></Text>)}</Box>}{versionLockInfo?.enabled && <Box flexDirection="column"><Text bold={true}>Version Locks</Text>{versionLockInfo.staleLocksCleaned > 0 && <Text dimColor={true}>└ Cleaned {versionLockInfo.staleLocksCleaned} stale lock(s)</Text>}{versionLockInfo.locks.length === 0 ? <Text dimColor={true}>└ No active version locks</Text> : versionLockInfo.locks.map((lock, i_2) => <Text key={i_2}>└ {lock.version}: PID {lock.pid}{" "}{lock.isProcessRunning ? <Text>(running)</Text> : <Text color="warning">(stale)</Text>}</Text>)}</Box>}{agentInfo?.failedFiles && agentInfo.failedFiles.length > 0 && <Box flexDirection="column"><Text bold={true} color="error">Agent Parse Errors</Text><Text color="error">└ Failed to parse {agentInfo.failedFiles.length} agent file(s):</Text>{agentInfo.failedFiles.map((file, i_3) => <Text key={i_3} dimColor={true}>{"  "}└ {file.path}: {file.error}</Text>)}</Box>}{pluginsErrors.length > 0 && <Box flexDirection="column"><Text bold={true} color="error">Plugin Errors</Text><Text color="error">└ {pluginsErrors.length} plugin error(s) detected:</Text>{pluginsErrors.map((error_0, i_4) => <Text key={i_4} dimColor={true}>{"  "}└ {error_0.source || "unknown"}{"plugin" in error_0 && error_0.plugin ? ` [${error_0.plugin}]` : ""}:{" "}{getPluginErrorMessage(error_0)}</Text>)}</Box>}{contextWarnings?.unreachableRulesWarning && <Box flexDirection="column"><Text bold={true} color="warning">Unreachable Permission Rules</Text><Text>└{" "}<Text color="warning">{figures.warning}{" "}{contextWarnings.unreachableRulesWarning.message}</Text></Text>{contextWarnings.unreachableRulesWarning.details.map((detail, i_5) => <Text key={i_5} dimColor={true}>{"  "}└ {detail}</Text>)}</Box>}{contextWarnings && (contextWarnings.claudeMdWarning || contextWarnings.agentWarning || contextWarnings.mcpWarning) && <Box flexDirection="column"><Text bold={true}>Context Usage Warnings</Text>{contextWarnings.claudeMdWarning && <><Text>└{" "}<Text color="warning">{figures.warning} {contextWarnings.claudeMdWarning.message}</Text></Text><Text>{"  "}└ Files:</Text>{contextWarnings.claudeMdWarning.details.map((detail_0, i_6) => <Text key={i_6} dimColor={true}>{"    "}└ {detail_0}</Text>)}</>}{contextWarnings.agentWarning && <><Text>└{" "}<Text color="warning">{figures.warning} {contextWarnings.agentWarning.message}</Text></Text><Text>{"  "}└ Top contributors:</Text>{contextWarnings.agentWarning.details.map((detail_1, i_7) => <Text key={i_7} dimColor={true}>{"    "}└ {detail_1}</Text>)}</>}{contextWarnings.mcpWarning && <><Text>└{" "}<Text color="warning">{figures.warning} {contextWarnings.mcpWarning.message}</Text></Text><Text>{"  "}└ MCP servers:</Text>{contextWarnings.mcpWarning.details.map((detail_2, i_8) => <Text key={i_8} dimColor={true}>{"    "}└ {detail_2}</Text>)}</>}</Box>}<Box><PressEnterToContinue /></Box></Pane>;
}
