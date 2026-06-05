import chalk from 'chalk';
import * as React from 'react';
import { useState } from 'react';
import type { SettingSource } from 'src/utils/settings/constants.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useMergedTools } from '../../hooks/useMergedTools.js';
import { Box, Text } from '../../ink.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { Tools } from '../../Tool.js';
import { type ResolvedAgent, resolveAgentOverrides } from '../../tools/AgentTool/agentDisplay.js';
import { type AgentDefinition, getActiveAgentsFromList } from '../../tools/AgentTool/loadAgentsDir.js';
import { toError } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { Select } from '../CustomSelect/select.js';
import { Dialog } from '../design-system/Dialog.js';
import { AgentDetail } from './AgentDetail.js';
import { AgentEditor } from './AgentEditor.js';
import { AgentNavigationFooter } from './AgentNavigationFooter.js';
import { AgentsList } from './AgentsList.js';
import { deleteAgentFromFile } from './agentFileUtils.js';
import { CreateAgentWizard } from './new-agent-creation/CreateAgentWizard.js';
import type { ModeState } from './types.js';

type Props = {
  tools: Tools;
  onExit: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};

export function AgentsMenu({ tools, onExit }: Props) {
  const [modeState, setModeState] = useState<ModeState>({
    mode: 'list-agents',
    source: 'all',
  });
  const agentDefinitions = useAppState(s => s.agentDefinitions);
  const mcpTools = useAppState(s => s.mcp.tools);
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const setAppState = useSetAppState();
  const { allAgents, activeAgents: agents } = agentDefinitions;
  const [changes, setChanges] = useState<string[]>([]);
  const mergedTools = useMergedTools(tools, mcpTools, toolPermissionContext);
  useExitOnCtrlCDWithKeybindings();

  const agentsBySource = {
    'built-in': allAgents.filter(a => a.source === 'built-in'),
    userSettings: allAgents.filter(a => a.source === 'userSettings'),
    projectSettings: allAgents.filter(a => a.source === 'projectSettings'),
    policySettings: allAgents.filter(a => a.source === 'policySettings'),
    localSettings: allAgents.filter(a => a.source === 'localSettings'),
    flagSettings: allAgents.filter(a => a.source === 'flagSettings'),
    plugin: allAgents.filter(a => a.source === 'plugin'),
    all: allAgents,
  };

  const handleAgentCreated = (message: string) => {
    setChanges(prev => [...prev, message]);
    setModeState({ mode: 'list-agents', source: 'all' });
  };

  const handleAgentDeleted = async (agent: AgentDefinition) => {
    try {
      await deleteAgentFromFile(agent);
      setAppState(state => {
        const allAgents = state.agentDefinitions.allAgents.filter(
          a => !(a.agentType === agent.agentType && a.source === agent.source),
        );
        return {
          ...state,
          agentDefinitions: {
            ...state.agentDefinitions,
            allAgents,
            activeAgents: getActiveAgentsFromList(allAgents),
          },
        };
      });
      setChanges(prev => [...prev, `Deleted agent: ${chalk.bold(agent.agentType)}`]);
      setModeState({ mode: 'list-agents', source: 'all' });
    } catch (error) {
      logError(toError(error));
    }
  };

  switch (modeState.mode) {
    case 'list-agents': {
      const agentsToShow =
        modeState.source === 'all'
          ? [
              ...agentsBySource['built-in'],
              ...agentsBySource.userSettings,
              ...agentsBySource.projectSettings,
              ...agentsBySource.localSettings,
              ...agentsBySource.policySettings,
              ...agentsBySource.flagSettings,
              ...agentsBySource.plugin,
            ]
          : agentsBySource[modeState.source];
      const resolvedAgents: ResolvedAgent[] = resolveAgentOverrides(agentsToShow, agents);

      const handleBack = () => {
        const exitMessage =
          changes.length > 0 ? `Agent changes:\n${changes.join('\n')}` : undefined;
        onExit(exitMessage ?? 'Agents dialog dismissed', {
          display: changes.length === 0 ? 'system' : undefined,
        });
      };
      const handleSelect = (agent: ResolvedAgent) =>
        setModeState({ mode: 'agent-menu', agent, previousMode: modeState });
      const handleCreateNew = () => setModeState({ mode: 'create-agent' });

      return (
        <>
          <AgentsList
            source={modeState.source}
            agents={resolvedAgents}
            onBack={handleBack}
            onSelect={handleSelect}
            onCreateNew={handleCreateNew}
            changes={changes}
          />
          <AgentNavigationFooter />
        </>
      );
    }
    case 'create-agent': {
      return (
        <CreateAgentWizard
          tools={mergedTools}
          existingAgents={agents}
          onComplete={handleAgentCreated}
          onCancel={() => setModeState({ mode: 'list-agents', source: 'all' })}
        />
      );
    }
    case 'agent-menu': {
      const freshAgent = allAgents.find(
        a =>
          a.agentType === modeState.agent.agentType && a.source === modeState.agent.source,
      );
      const agentToUse = freshAgent || modeState.agent;
      const isEditable =
        agentToUse.source !== 'built-in' &&
        agentToUse.source !== 'plugin' &&
        agentToUse.source !== 'flagSettings';

      const menuItems = [
        { label: 'View agent', value: 'view' },
        ...(isEditable
          ? [
              { label: 'Edit agent', value: 'edit' },
              { label: 'Delete agent', value: 'delete' },
            ]
          : []),
        { label: 'Back', value: 'back' },
      ];

      const handleMenuSelect = (value: string) => {
        switch (value) {
          case 'view': {
            setModeState({
              mode: 'view-agent',
              agent: agentToUse,
              previousMode: modeState.previousMode,
            });
            break;
          }
          case 'edit': {
            setModeState({
              mode: 'edit-agent',
              agent: agentToUse,
              previousMode: modeState,
            });
            break;
          }
          case 'delete': {
            setModeState({
              mode: 'delete-confirm',
              agent: agentToUse,
              previousMode: modeState,
            });
            break;
          }
          case 'back': {
            setModeState(modeState.previousMode);
          }
        }
      };

      return (
        <>
          <Dialog
            title={modeState.agent.agentType}
            onCancel={() => setModeState(modeState.previousMode)}
            hideInputGuide={true}
          >
            <Box flexDirection="column">
              <Select
                options={menuItems}
                onChange={handleMenuSelect}
                onCancel={() => setModeState(modeState.previousMode)}
              />
              {changes.length > 0 && (
                <Box marginTop={1}>
                  <Text dimColor={true}>{changes[changes.length - 1]}</Text>
                </Box>
              )}
            </Box>
          </Dialog>
          <AgentNavigationFooter />
        </>
      );
    }
    case 'view-agent': {
      const freshAgent = allAgents.find(
        a =>
          a.agentType === modeState.agent.agentType && a.source === modeState.agent.source,
      );
      const agentToDisplay = freshAgent || modeState.agent;

      const goToMenu = () =>
        setModeState({
          mode: 'agent-menu',
          agent: agentToDisplay,
          previousMode: modeState.previousMode,
        });

      return (
        <>
          <Dialog title={agentToDisplay.agentType} onCancel={goToMenu} hideInputGuide={true}>
            <AgentDetail
              agent={agentToDisplay}
              tools={mergedTools}
              allAgents={allAgents}
              onBack={goToMenu}
            />
          </Dialog>
          <AgentNavigationFooter instructions="Press Enter or Esc to go back" />
        </>
      );
    }
    case 'delete-confirm': {
      const deleteOptions = [
        { label: 'Yes, delete', value: 'yes' },
        { label: 'No, cancel', value: 'no' },
      ];

      const cancel = () => {
        if ('previousMode' in modeState) {
          setModeState(modeState.previousMode);
        }
      };
      const handleChange = (value: string) => {
        if (value === 'yes') {
          handleAgentDeleted(modeState.agent);
        } else {
          if ('previousMode' in modeState) {
            setModeState(modeState.previousMode);
          }
        }
      };

      return (
        <>
          <Dialog title="Delete agent" onCancel={cancel} color="error">
            <Text>
              Are you sure you want to delete the agent{' '}
              <Text bold={true}>{modeState.agent.agentType}</Text>?
            </Text>
            <Box marginTop={1}>
              <Text dimColor={true}>Source: {modeState.agent.source}</Text>
            </Box>
            <Box marginTop={1}>
              <Select options={deleteOptions} onChange={handleChange} onCancel={cancel} />
            </Box>
          </Dialog>
          <AgentNavigationFooter
            instructions={'Press ↑↓ to navigate, Enter to select, Esc to cancel'}
          />
        </>
      );
    }
    case 'edit-agent': {
      const freshAgent = allAgents.find(
        a =>
          a.agentType === modeState.agent.agentType && a.source === modeState.agent.source,
      );
      const agentToEdit = freshAgent || modeState.agent;
      const title = `Edit agent: ${agentToEdit.agentType}`;

      const onSaved = (message: string) => {
        handleAgentCreated(message);
        setModeState(modeState.previousMode);
      };
      const onBack = () => setModeState(modeState.previousMode);

      return (
        <>
          <Dialog title={title} onCancel={onBack} hideInputGuide={true}>
            <AgentEditor
              agent={agentToEdit}
              tools={mergedTools}
              onSaved={onSaved}
              onBack={onBack}
            />
          </Dialog>
          <AgentNavigationFooter />
        </>
      );
    }
    default: {
      return null;
    }
  }
}
