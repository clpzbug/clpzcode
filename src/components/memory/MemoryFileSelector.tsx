import { feature } from 'bun:bundle';
import chalk from 'chalk';
import { mkdir } from 'fs/promises';
import { basename, join } from 'path';
import * as React from 'react';
import { use, useEffect, useState } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js';
import { logEvent } from '../../services/analytics/index.js';
import { isAutoDreamEnabled } from '../../services/autoDream/config.js';
import { readLastConsolidatedAt } from '../../services/autoDream/consolidationLock.js';
import { useAppState } from '../../state/AppState.js';
import { getAgentMemoryDir } from '../../tools/AgentTool/agentMemory.js';
import { openPath } from '../../utils/browser.js';
import { getMemoryFiles, type MemoryFileInfo } from '../../utils/claudemd.js';
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatRelativeTimeAgo } from '../../utils/format.js';
import { projectIsInGitRepo } from '../../utils/memory/versions.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
import { Select } from '../CustomSelect/index.js';
import { ListItem } from '../design-system/ListItem.js';
import { getProjectMemoryPathForSelector } from './memoryFileSelectorPaths.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemPaths = feature('TEAMMEM') ? require('../../memdir/teamMemPaths.js') as typeof import('../../memdir/teamMemPaths.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

interface ExtendedMemoryFileInfo extends MemoryFileInfo {
  isNested?: boolean;
  exists: boolean;
}

// Remember last selected path
let lastSelectedPath: string | undefined;
const OPEN_FOLDER_PREFIX = '__open_folder__';
type Props = {
  onSelect: (path: string) => void;
  onCancel: () => void;
};
export function MemoryFileSelector({ onSelect, onCancel }: Props) {
  const existingMemoryFiles = use(getMemoryFiles());
  const originalCwd = getOriginalCwd();
  const userMemoryPath = join(getClaudeConfigHomeDir(), "CLAUDE.md");
  const projectMemoryPath = getProjectMemoryPathForSelector(existingMemoryFiles, originalCwd);
  const projectMemoryFileName = basename(projectMemoryPath);
  const hasUserMemory = existingMemoryFiles.some(f => f.path === userMemoryPath);
  const hasProjectMemory = existingMemoryFiles.some(f => f.path === projectMemoryPath);
  const allMemoryFiles: ExtendedMemoryFileInfo[] = [...existingMemoryFiles.filter(f => f.type !== "AutoMem" && f.type !== "TeamMem").map(f => ({
    ...f,
    exists: true
  })), ...(hasUserMemory ? [] : [{
    path: userMemoryPath,
    type: "User" as const,
    content: "",
    exists: false
  }]), ...(hasProjectMemory ? [] : [{
    path: projectMemoryPath,
    type: "Project" as const,
    content: "",
    exists: false
  }])];
  const depths = new Map();
  const memoryOptions = allMemoryFiles.map(file => {
    const displayPath = getDisplayPath(file.path);
    const existsLabel = file.exists ? "" : " (new)";
    const depth = file.parent ? (depths.get(file.parent) ?? 0) + 1 : 0;
    depths.set(file.path, depth);
    const indent = depth > 0 ? "  ".repeat(depth - 1) : "";
    let label;
    if (file.type === "User" && !file.isNested && file.path === userMemoryPath) {
      label = "User memory";
    } else {
      if (file.type === "Project" && !file.isNested && file.path === projectMemoryPath) {
        label = "Project memory";
      } else {
        if (depth > 0) {
          label = `${indent}L ${displayPath}${existsLabel}`;
        } else {
          label = `${displayPath}`;
        }
      }
    }
    let description;
    const isGit = projectIsInGitRepo(originalCwd);
    if (file.type === "User" && !file.isNested) {
      description = "Saved in ~/.claude/CLAUDE.md";
    } else {
      if (file.type === "Project" && !file.isNested && file.path === projectMemoryPath) {
        description = `${isGit ? "Checked in at" : "Saved in"} ./${projectMemoryFileName}`;
      } else {
        if (file.parent) {
          description = "@-imported";
        } else {
          if (file.isNested) {
            description = "dynamically loaded";
          } else {
            description = "";
          }
        }
      }
    }
    return {
      label,
      value: file.path,
      description
    };
  });
  const folderOptions: { label: string; value: string; description: string }[] = [];
  const agentDefinitions = useAppState(s => s.agentDefinitions);
  if (isAutoMemoryEnabled()) {
    folderOptions.push({
      label: "Open auto-memory folder",
      value: `${OPEN_FOLDER_PREFIX}${getAutoMemPath()}`,
      description: ""
    });
    if (feature("TEAMMEM") && teamMemPaths?.isTeamMemoryEnabled()) {
      folderOptions.push({
        label: "Open team memory folder",
        value: `${OPEN_FOLDER_PREFIX}${teamMemPaths?.getTeamMemPath()}`,
        description: ""
      });
    }
    for (const agent of agentDefinitions.activeAgents) {
      if (agent.memory) {
        const agentDir = getAgentMemoryDir(agent.agentType, agent.memory);
        folderOptions.push({
          label: `Open ${chalk.bold(agent.agentType)} agent memory`,
          value: `${OPEN_FOLDER_PREFIX}${agentDir}`,
          description: `${agent.memory} scope`
        });
      }
    }
  }
  memoryOptions.push(...folderOptions);
  const initialPath = lastSelectedPath && memoryOptions.some(opt => opt.value === lastSelectedPath) ? lastSelectedPath : memoryOptions[0]?.value || "";
  const [autoMemoryOn, setAutoMemoryOn] = useState(isAutoMemoryEnabled);
  const [autoDreamOn, setAutoDreamOn] = useState(isAutoDreamEnabled);
  const [showDreamRow] = useState(isAutoMemoryEnabled);
  const isDreamRunning = useAppState(s => Object.values(s.tasks).some((t: any) => t.type === "dream" && t.status === "running"));
  const [lastDreamAt, setLastDreamAt] = useState<number | null>(null);
  useEffect(() => {
    if (!showDreamRow) {
      return;
    }
    readLastConsolidatedAt().then(setLastDreamAt);
  }, [showDreamRow, isDreamRunning]);
  const dreamStatus = isDreamRunning ? "running" : lastDreamAt === null ? "" : lastDreamAt === 0 ? "never" : `last ran ${formatRelativeTimeAgo(new Date(lastDreamAt))}`;
  const [focusedToggle, setFocusedToggle] = useState<number | null>(null);
  const toggleFocused = focusedToggle !== null;
  const lastToggleIndex = showDreamRow ? 1 : 0;
  const handleToggleAutoMemory = function handleToggleAutoMemory() {
    const newValue = !autoMemoryOn;
    updateSettingsForSource("userSettings", {
      autoMemoryEnabled: newValue
    });
    setAutoMemoryOn(newValue);
    logEvent("tengu_auto_memory_toggled", {
      enabled: newValue
    });
  };
  const handleToggleAutoDream = function handleToggleAutoDream() {
    const newValue = !autoDreamOn;
    updateSettingsForSource("userSettings", {
      autoDreamEnabled: newValue
    });
    setAutoDreamOn(newValue);
    logEvent("tengu_auto_dream_toggled", {
      enabled: newValue
    });
  };
  useExitOnCtrlCDWithKeybindings();
  useKeybinding("confirm:no", onCancel, {
    context: "Confirmation"
  });
  useKeybinding("confirm:yes", () => {
    if (focusedToggle === 0) {
      handleToggleAutoMemory();
    } else {
      if (focusedToggle === 1) {
        handleToggleAutoDream();
      }
    }
  }, {
    context: "Confirmation",
    isActive: toggleFocused
  });
  useKeybinding("select:next", () => {
    setFocusedToggle(prev => prev !== null && prev < lastToggleIndex ? prev + 1 : null);
  }, {
    context: "Select",
    isActive: toggleFocused
  });
  useKeybinding("select:previous", () => {
    setFocusedToggle(prev => prev !== null && prev > 0 ? prev - 1 : prev);
  }, {
    context: "Select",
    isActive: toggleFocused
  });
  const toggleRows = <Box flexDirection="column" marginBottom={1}>
    <ListItem isFocused={focusedToggle === 0}><Text>Auto-memory: {autoMemoryOn ? "on" : "off"}</Text></ListItem>
    {showDreamRow && <ListItem isFocused={focusedToggle === 1} styled={false}><Text color={focusedToggle === 1 ? "suggestion" : undefined}>Auto-dream: {autoDreamOn ? "on" : "off"}{dreamStatus && <Text dimColor={true}> · {dreamStatus}</Text>}{!isDreamRunning && autoDreamOn && <Text dimColor={true}> · /dream to run</Text>}</Text></ListItem>}
  </Box>;
  const handleChange = (value: string) => {
    if (value.startsWith(OPEN_FOLDER_PREFIX)) {
      const folderPath = value.slice(OPEN_FOLDER_PREFIX.length);
      mkdir(folderPath, {
        recursive: true
      }).catch(() => {}).then(() => openPath(folderPath));
      return;
    }
    lastSelectedPath = value;
    onSelect(value);
  };
  return <Box flexDirection="column" width="100%">{toggleRows}<Select defaultFocusValue={initialPath} options={memoryOptions} isDisabled={toggleFocused} onChange={handleChange} onCancel={onCancel} onUpFromFirstItem={() => setFocusedToggle(lastToggleIndex)} /></Box>;
}
