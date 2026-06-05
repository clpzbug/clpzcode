import React from 'react';
import { isAutoMemoryEnabled } from '../../../memdir/paths.js';
import type { Tools } from '../../../Tool.js';
import type { AgentDefinition } from '../../../tools/AgentTool/loadAgentsDir.js';
import { WizardProvider } from '../../wizard/index.js';
import { ColorStep } from './wizard-steps/ColorStep.js';
import { ConfirmStepWrapper } from './wizard-steps/ConfirmStepWrapper.js';
import { DescriptionStep } from './wizard-steps/DescriptionStep.js';
import { GenerateStep } from './wizard-steps/GenerateStep.js';
import { LocationStep } from './wizard-steps/LocationStep.js';
import { MemoryStep } from './wizard-steps/MemoryStep.js';
import { MethodStep } from './wizard-steps/MethodStep.js';
import { ModelStep } from './wizard-steps/ModelStep.js';
import { PromptStep } from './wizard-steps/PromptStep.js';
import { ToolsStep } from './wizard-steps/ToolsStep.js';
import { TypeStep } from './wizard-steps/TypeStep.js';

type Props = {
  tools: Tools;
  existingAgents: AgentDefinition[];
  onComplete: (message: string) => void;
  onCancel: () => void;
};

export function CreateAgentWizard({ tools, existingAgents, onComplete, onCancel }: Props) {
  const TypeStepWrapped = () => <TypeStep existingAgents={existingAgents} />;
  const ToolsStepWrapped = () => <ToolsStep tools={tools} />;
  const memorySteps = isAutoMemoryEnabled() ? [MemoryStep] : [];
  const ConfirmStepWrapped = () => (
    <ConfirmStepWrapper tools={tools} existingAgents={existingAgents} onComplete={onComplete} />
  );

  const steps = [
    LocationStep,
    MethodStep,
    GenerateStep,
    TypeStepWrapped,
    PromptStep,
    DescriptionStep,
    ToolsStepWrapped,
    ModelStep,
    ColorStep,
    ...memorySteps,
    ConfirmStepWrapped,
  ];

  return (
    <WizardProvider
      steps={steps}
      initialData={{}}
      onComplete={() => {}}
      onCancel={onCancel}
      title="Create new agent"
      showStepCounter={false}
    />
  );
}
