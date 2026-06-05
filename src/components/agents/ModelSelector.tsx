import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { getAgentModelOptions } from '../../utils/model/agent.js';
import { Select } from '../CustomSelect/select.js';
interface ModelSelectorProps {
  initialModel?: string;
  onComplete: (model?: string) => void;
  onCancel?: () => void;
}
export function ModelSelector({ initialModel, onComplete, onCancel }: ModelSelectorProps) {
  let modelOptions;
  {
    const base = getAgentModelOptions();
    if (initialModel && !base.some(o => o.value === initialModel)) {
      modelOptions = [{
        value: initialModel,
        label: initialModel,
        description: "Current model (custom ID)"
      }, ...base];
    } else {
      modelOptions = base;
    }
  }
  const defaultModel = initialModel ?? "sonnet";
  const handleCancel = () => onCancel ? onCancel() : onComplete(undefined);
  return <Box flexDirection="column"><Box marginBottom={1}><Text dimColor={true}>Model determines the agent's reasoning capabilities and speed.</Text></Box><Select options={modelOptions} defaultValue={defaultModel} onChange={onComplete} onCancel={handleCancel} /></Box>;
}
