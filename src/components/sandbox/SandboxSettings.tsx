import React from 'react';
import { Box, color, Link, Text, useTheme } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { CommandResultDisplay } from '../../types/command.js';
import type { SandboxDependencyCheck } from '../../utils/sandbox/sandbox-adapter.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js';
import { Select } from '../CustomSelect/select.js';
import { Pane } from '../design-system/Pane.js';
import { Tab, Tabs, useTabHeaderFocus } from '../design-system/Tabs.js';
import { SandboxConfigTab } from './SandboxConfigTab.js';
import { SandboxDependenciesTab } from './SandboxDependenciesTab.js';
import { SandboxOverridesTab } from './SandboxOverridesTab.js';
type Props = {
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  depCheck: SandboxDependencyCheck;
};
type SandboxMode = 'auto-allow' | 'regular' | 'disabled';
export function SandboxSettings({ onComplete, depCheck }: Props) {
  const [theme] = useTheme();
  const currentEnabled = SandboxManager.isSandboxingEnabled();
  const currentAutoAllow = SandboxManager.isAutoAllowBashIfSandboxedEnabled();
  const hasWarnings = depCheck.warnings.length > 0;
  const settings = getSettings_DEPRECATED();
  const allowAllUnixSockets = settings.sandbox?.network?.allowAllUnixSockets;
  const showSocketWarning = hasWarnings && !allowAllUnixSockets;
  const getCurrentMode = () => {
    if (!currentEnabled) {
      return "disabled";
    }
    if (currentAutoAllow) {
      return "auto-allow";
    }
    return "regular";
  };
  const currentMode = getCurrentMode();
  const currentIndicator = color("success", theme)("(current)");
  const autoAllowLabel = currentMode === "auto-allow" ? `Sandbox BashTool, with auto-allow ${currentIndicator}` : "Sandbox BashTool, with auto-allow";
  const autoAllowOption = {
    label: autoAllowLabel,
    value: "auto-allow"
  };
  const regularLabel = currentMode === "regular" ? `Sandbox BashTool, with regular permissions ${currentIndicator}` : "Sandbox BashTool, with regular permissions";
  const regularOption = {
    label: regularLabel,
    value: "regular"
  };
  const disabledLabel = currentMode === "disabled" ? `No Sandbox ${currentIndicator}` : "No Sandbox";
  const disabledOption = {
    label: disabledLabel,
    value: "disabled"
  };
  const options = [autoAllowOption, regularOption, disabledOption];
  const handleSelect = async function handleSelect(value: string) {
    const mode = value as SandboxMode;
    bb33: switch (mode) {
      case "auto-allow":
        {
          await SandboxManager.setSandboxSettings({
            enabled: true,
            autoAllowBashIfSandboxed: true
          });
          onComplete("✓ Sandbox enabled with auto-allow for bash commands");
          break bb33;
        }
      case "regular":
        {
          await SandboxManager.setSandboxSettings({
            enabled: true,
            autoAllowBashIfSandboxed: false
          });
          onComplete("✓ Sandbox enabled with regular bash permissions");
          break bb33;
        }
      case "disabled":
        {
          await SandboxManager.setSandboxSettings({
            enabled: false,
            autoAllowBashIfSandboxed: false
          });
          onComplete("○ Sandbox disabled");
        }
    }
  };
  useKeybindings({
    "confirm:no": () => onComplete(undefined, {
      display: "skip"
    })
  }, {
    context: "Settings"
  });
  const modeTab = <Tab key="mode" title="Mode"><SandboxModeTab showSocketWarning={showSocketWarning} options={options} onSelect={handleSelect} onComplete={onComplete} /></Tab>;
  const overridesTab = <Tab key="overrides" title="Overrides"><SandboxOverridesTab onComplete={onComplete} /></Tab>;
  const configTab = <Tab key="config" title="Config"><SandboxConfigTab /></Tab>;
  const hasErrors = depCheck.errors.length > 0;
  const tabs = hasErrors ? [<Tab key="dependencies" title="Dependencies"><SandboxDependenciesTab depCheck={depCheck} /></Tab>] : [modeTab, ...(hasWarnings ? [<Tab key="dependencies" title="Dependencies"><SandboxDependenciesTab depCheck={depCheck} /></Tab>] : []), overridesTab, configTab];
  return <Pane color="permission"><Tabs title="Sandbox:" color="permission" defaultTab="Mode">{tabs}</Tabs></Pane>;
}
type SandboxModeTabProps = {
  showSocketWarning: boolean;
  options: Array<{ label: string; value: string }>;
  onSelect: (value: string) => void;
  onComplete: Props['onComplete'];
};
function SandboxModeTab({ showSocketWarning, options, onSelect, onComplete }: SandboxModeTabProps) {
  const {
    headerFocused,
    focusHeader
  } = useTabHeaderFocus();
  const socketWarning = showSocketWarning && <Box marginBottom={1}><Text color="warning">Cannot block unix domain sockets (see Dependencies tab)</Text></Box>;
  const onCancel = () => onComplete(undefined, {
    display: "skip"
  });
  return <Box flexDirection="column" paddingY={1}>{socketWarning}<Box marginBottom={1}><Text bold={true}>Configure Mode:</Text></Box><Select options={options} onChange={onSelect} onCancel={onCancel} onUpFromFirstItem={focusHeader} isDisabled={headerFocused} /><Box flexDirection="column" marginTop={1} gap={1}><Text dimColor={true}><Text bold={true} dimColor={true}>Auto-allow mode:</Text>{" "}Commands will try to run in the sandbox automatically, and attempts to run outside of the sandbox fallback to regular permissions. Explicit ask/deny rules are always respected.</Text><Text dimColor={true}>Learn more:{" "}<Link url="https://code.claude.com/docs/en/sandboxing">code.claude.com/docs/en/sandboxing</Link></Text></Box></Box>;
}
