import figures from 'figures';
import * as React from 'react';
import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js';
import type { SettingSource } from 'src/utils/settings/constants.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import type { ResolvedAgent } from '../../tools/AgentTool/agentDisplay.js';
import { AGENT_SOURCE_GROUPS, compareAgentsByName, getOverrideSourceLabel, resolveAgentModelDisplay } from '../../tools/AgentTool/agentDisplay.js';
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js';
import { count } from '../../utils/array.js';
import { Dialog } from '../design-system/Dialog.js';
import { Divider } from '../design-system/Divider.js';
import { getAgentSourceDisplayName } from './utils.js';
type Props = {
  source: SettingSource | 'all' | 'built-in' | 'plugin';
  agents: ResolvedAgent[];
  onBack: () => void;
  onSelect: (agent: AgentDefinition) => void;
  onCreateNew?: () => void;
  changes?: string[];
};
export function AgentsList({ source, agents, onBack, onSelect, onCreateNew, changes }: Props) {
  const [selectedAgent, setSelectedAgent] = React.useState<ResolvedAgent | null>(null);
  const [isCreateNewSelected, setIsCreateNewSelected] = React.useState(true);
  const sortedAgents = [...agents].sort(compareAgentsByName);
  const getOverrideInfo = (agent: ResolvedAgent) => ({
    isOverridden: !!agent.overriddenBy,
    overriddenBy: agent.overriddenBy || null
  });
  const renderCreateNewOption = () => <Box><Text color={isCreateNewSelected ? "suggestion" : undefined}>{isCreateNewSelected ? `${figures.pointer} ` : "  "}</Text><Text color={isCreateNewSelected ? "suggestion" : undefined}>Create new agent</Text></Box>;
  const renderAgent = (agent: ResolvedAgent) => {
    const isBuiltIn = agent.source === "built-in";
    const isSelected = !isBuiltIn && !isCreateNewSelected && selectedAgent?.agentType === agent.agentType && selectedAgent?.source === agent.source;
    const {
      isOverridden,
      overriddenBy
    } = getOverrideInfo(agent);
    const dimmed = isBuiltIn || isOverridden;
    const textColor = !isBuiltIn && isSelected ? "suggestion" : undefined;
    const resolvedModel = resolveAgentModelDisplay(agent);
    return <Box key={`${agent.agentType}-${agent.source}`}><Text dimColor={dimmed && !isSelected} color={textColor}>{isBuiltIn ? "" : isSelected ? `${figures.pointer} ` : "  "}</Text><Text dimColor={dimmed && !isSelected} color={textColor}>{agent.agentType}</Text>{resolvedModel && <Text dimColor={true} color={textColor}>{" \xB7 "}{resolvedModel}</Text>}{agent.memory && <Text dimColor={true} color={textColor}>{" \xB7 "}{agent.memory} memory</Text>}{overriddenBy && <Text dimColor={!isSelected} color={isSelected ? "warning" : undefined}>{" "}{figures.warning} shadowed by {getOverrideSourceLabel(overriddenBy)}</Text>}</Box>;
  };
  const nonBuiltIn = sortedAgents.filter(a => a.source !== "built-in");
  const selectableAgentsInOrder = source === "all" ? AGENT_SOURCE_GROUPS.filter(g => g.source !== "built-in").flatMap(({ source: groupSource }) => nonBuiltIn.filter(a => a.source === groupSource)) : nonBuiltIn;
  React.useEffect(() => {
    if (!selectedAgent && !isCreateNewSelected && selectableAgentsInOrder.length > 0) {
      if (onCreateNew) {
        setIsCreateNewSelected(true);
      } else {
        setSelectedAgent(selectableAgentsInOrder[0] || null);
      }
    }
  }, [selectableAgentsInOrder, selectedAgent, isCreateNewSelected, onCreateNew]);
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "return") {
      e.preventDefault();
      if (isCreateNewSelected && onCreateNew) {
        onCreateNew();
      } else {
        if (selectedAgent) {
          onSelect(selectedAgent);
        }
      }
      return;
    }
    if (e.key !== "up" && e.key !== "down") {
      return;
    }
    e.preventDefault();
    const hasCreateOption = !!onCreateNew;
    const totalItems = selectableAgentsInOrder.length + (hasCreateOption ? 1 : 0);
    if (totalItems === 0) {
      return;
    }
    let currentPosition = 0;
    if (!isCreateNewSelected && selectedAgent) {
      const agentIndex = selectableAgentsInOrder.findIndex(a => a.agentType === selectedAgent.agentType && a.source === selectedAgent.source);
      if (agentIndex >= 0) {
        currentPosition = hasCreateOption ? agentIndex + 1 : agentIndex;
      }
    }
    const newPosition = e.key === "up" ? currentPosition === 0 ? totalItems - 1 : currentPosition - 1 : currentPosition === totalItems - 1 ? 0 : currentPosition + 1;
    if (hasCreateOption && newPosition === 0) {
      setIsCreateNewSelected(true);
      setSelectedAgent(null);
    } else {
      const agentIndex = hasCreateOption ? newPosition - 1 : newPosition;
      const newAgent = selectableAgentsInOrder[agentIndex];
      if (newAgent) {
        setIsCreateNewSelected(false);
        setSelectedAgent(newAgent);
      }
    }
  };
  const renderBuiltInAgentsSection = (title: string = "Built-in (always available):") => {
    const builtInAgents = sortedAgents.filter(a => a.source === "built-in");
    return <Box flexDirection="column" marginBottom={1} paddingLeft={2}><Text bold={true} dimColor={true}>{title}</Text>{builtInAgents.map(renderAgent)}</Box>;
  };
  const renderAgentGroup = (title: string, groupAgents: ResolvedAgent[]) => {
    if (!groupAgents.length) {
      return null;
    }
    const folderPath = groupAgents[0]?.baseDir;
    return <Box flexDirection="column" marginBottom={1}><Box paddingLeft={2}><Text bold={true} dimColor={true}>{title}</Text>{folderPath && <Text dimColor={true}> ({folderPath})</Text>}</Box>{groupAgents.map(agent => renderAgent(agent))}</Box>;
  };
  const sourceTitle = getAgentSourceDisplayName(source);
  const builtInAgents = sortedAgents.filter(a => a.source === "built-in");
  const hasNoAgents = !sortedAgents.length || source !== "built-in" && !sortedAgents.some(a => a.source !== "built-in");
  if (hasNoAgents) {
    return <Dialog title={sourceTitle} subtitle="No agents found" onCancel={onBack} hideInputGuide={true}><Box flexDirection="column" gap={1} tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{onCreateNew && <Box>{renderCreateNewOption()}</Box>}<Text dimColor={true}>No agents found. Create specialized subagents that {PRODUCT_DISPLAY_NAME} can delegate to.</Text><Text dimColor={true}>Each subagent has its own context window, custom system prompt, and specific tools.</Text><Text dimColor={true}>Try creating: Code Reviewer, Code Simplifier, Security Reviewer, Tech Lead, or UX Reviewer.</Text>{source !== "built-in" && sortedAgents.some(a => a.source === "built-in") && <><Divider />{renderBuiltInAgentsSection()}</>}</Box></Dialog>;
  }
  return <Dialog title={sourceTitle} subtitle={`${count(sortedAgents, a => !a.overriddenBy)} agents`} onCancel={onBack} hideInputGuide={true}>{changes && changes.length > 0 && <Box marginTop={1}><Text dimColor={true}>{changes[changes.length - 1]}</Text></Box>}<Box flexDirection="column" tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{onCreateNew && <Box marginBottom={1}>{renderCreateNewOption()}</Box>}{source === "all" ? <>{AGENT_SOURCE_GROUPS.filter(g => g.source !== "built-in").map(({ label, source: groupSource }) => <React.Fragment key={groupSource}>{renderAgentGroup(label, sortedAgents.filter(a => a.source === groupSource))}</React.Fragment>)}{builtInAgents.length > 0 && <Box flexDirection="column" marginBottom={1} paddingLeft={2}><Text dimColor={true}><Text bold={true}>Built-in agents</Text> (always available)</Text>{builtInAgents.map(renderAgent)}</Box>}</> : source === "built-in" ? <><Text dimColor={true} italic={true}>Built-in agents are provided by default and cannot be modified.</Text><Box marginTop={1} flexDirection="column">{sortedAgents.map(agent => renderAgent(agent))}</Box></> : <>{sortedAgents.filter(a => a.source !== "built-in").map(agent => renderAgent(agent))}{sortedAgents.some(a => a.source === "built-in") && <><Divider />{renderBuiltInAgentsSection()}</>}</>}</Box></Dialog>;
}
