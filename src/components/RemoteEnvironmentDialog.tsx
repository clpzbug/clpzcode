import chalk from 'chalk';
import figures from 'figures';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { toError } from '../utils/errors.js';
import { logError } from '../utils/log.js';
import { getSettingSourceName, type SettingSource } from '../utils/settings/constants.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import { getEnvironmentSelectionInfo } from '../utils/teleport/environmentSelection.js';
import type { EnvironmentResource } from '../utils/teleport/environments.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/select.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { LoadingState } from './design-system/LoadingState.js';
const DIALOG_TITLE = 'Select Remote Environment';
const SETUP_HINT = `Configure environments at: https://claude.ai/code`;
type Props = {
  onDone: (message?: string) => void;
};
type LoadingState = 'loading' | 'updating' | null;
export function RemoteEnvironmentDialog({ onDone }: Props) {
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [environments, setEnvironments] = useState<EnvironmentResource[]>([]);
  const [selectedEnvironment, setSelectedEnvironment] = useState<EnvironmentResource | null>(null);
  const [selectedEnvironmentSource, setSelectedEnvironmentSource] = useState<SettingSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetchInfo = async function fetchInfo() {
      try {
        const result = await getEnvironmentSelectionInfo();
        if (cancelled) {
          return;
        }
        setEnvironments(result.availableEnvironments);
        setSelectedEnvironment(result.selectedEnvironment);
        setSelectedEnvironmentSource(result.selectedEnvironmentSource);
        setLoadingState(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        const fetchError = toError(err);
        logError(fetchError);
        setError(fetchError.message);
        setLoadingState(null);
      }
    };
    fetchInfo();
    return () => {
      cancelled = true;
    };
  }, []);
  const handleSelect = function handleSelect(value: string) {
    if (value === "cancel") {
      onDone();
      return;
    }
    setLoadingState("updating");
    const selectedEnv = environments.find(env => env.environment_id === value);
    if (!selectedEnv) {
      onDone("Error: Selected environment not found");
      return;
    }
    updateSettingsForSource("localSettings", {
      remote: {
        defaultEnvironmentId: selectedEnv.environment_id
      }
    });
    onDone(`Set default remote environment to ${chalk.bold(selectedEnv.name)} (${selectedEnv.environment_id})`);
  };
  if (loadingState === "loading") {
    return <Dialog title={DIALOG_TITLE} onCancel={onDone} hideInputGuide={true}><LoadingState message={"Loading environments\u2026"} /></Dialog>;
  }
  if (error) {
    return <Dialog title={DIALOG_TITLE} onCancel={onDone}><Text color="error">Error: {error}</Text></Dialog>;
  }
  if (!selectedEnvironment) {
    return <Dialog title={DIALOG_TITLE} subtitle={SETUP_HINT} onCancel={onDone}><Text>No remote environments available.</Text></Dialog>;
  }
  if (environments.length === 1) {
    return <SingleEnvironmentContent environment={selectedEnvironment} onDone={onDone} />;
  }
  return <MultipleEnvironmentsContent environments={environments} selectedEnvironment={selectedEnvironment} selectedEnvironmentSource={selectedEnvironmentSource} loadingState={loadingState} onSelect={handleSelect} onCancel={onDone} />;
}
function EnvironmentLabel({ environment }: { environment: EnvironmentResource }) {
  return <Text>{figures.tick} Using <Text bold={true}>{environment.name}</Text>{" "}<Text dimColor={true}>({environment.environment_id})</Text></Text>;
}
function SingleEnvironmentContent({ environment, onDone }: { environment: EnvironmentResource; onDone: (message?: string) => void }) {
  useKeybinding("confirm:yes", onDone, {
    context: "Confirmation"
  });
  return <Dialog title={DIALOG_TITLE} subtitle={SETUP_HINT} onCancel={onDone}><EnvironmentLabel environment={environment} /></Dialog>;
}
function MultipleEnvironmentsContent({ environments, selectedEnvironment, selectedEnvironmentSource, loadingState, onSelect, onCancel }: {
  environments: EnvironmentResource[];
  selectedEnvironment: EnvironmentResource;
  selectedEnvironmentSource: SettingSource | null;
  loadingState: LoadingState;
  onSelect: (value: string) => void;
  onCancel: (message?: string) => void;
}) {
  const sourceSuffix = selectedEnvironmentSource && selectedEnvironmentSource !== "localSettings" ? ` (from ${getSettingSourceName(selectedEnvironmentSource)} settings)` : "";
  const subtitle = <Text>Currently using: <Text bold={true}>{selectedEnvironment.name}</Text>{sourceSuffix}</Text>;
  return <Dialog title={DIALOG_TITLE} subtitle={subtitle} onCancel={onCancel} hideInputGuide={true}>
    <Text dimColor={true}>{SETUP_HINT}</Text>
    {loadingState === "updating" ? <LoadingState message={"Updating\u2026"} /> : <Select options={environments.map(_temp)} defaultValue={selectedEnvironment.environment_id} onChange={onSelect} onCancel={() => onSelect("cancel")} layout="compact-vertical" />}
    <Text dimColor={true}><Byline><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline></Text>
  </Dialog>;
}
function _temp(env: EnvironmentResource) {
  return {
    label: <Text>{env.name} <Text dimColor={true}>({env.environment_id})</Text></Text>,
    value: env.environment_id
  };
}
