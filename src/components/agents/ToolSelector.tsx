import figures from 'figures';
import React, { useCallback, useMemo, useState } from 'react';
import { mcpInfoFromString } from 'src/services/mcp/mcpStringUtils.js';
import { isMcpTool } from 'src/services/mcp/utils.js';
import type { Tool, Tools } from 'src/Tool.js';
import { filterToolsForAgent } from 'src/tools/AgentTool/agentToolUtils.js';
import { AGENT_TOOL_NAME } from 'src/tools/AgentTool/constants.js';
import { BashTool } from 'src/tools/BashTool/BashTool.js';
import { ExitPlanModeV2Tool } from 'src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js';
import { FileEditTool } from 'src/tools/FileEditTool/FileEditTool.js';
import { FileReadTool } from 'src/tools/FileReadTool/FileReadTool.js';
import { FileWriteTool } from 'src/tools/FileWriteTool/FileWriteTool.js';
import { GlobTool } from 'src/tools/GlobTool/GlobTool.js';
import { GrepTool } from 'src/tools/GrepTool/GrepTool.js';
import { ListMcpResourcesTool } from 'src/tools/ListMcpResourcesTool/ListMcpResourcesTool.js';
import { NotebookEditTool } from 'src/tools/NotebookEditTool/NotebookEditTool.js';
import { ReadMcpResourceTool } from 'src/tools/ReadMcpResourceTool/ReadMcpResourceTool.js';
import { TaskOutputTool } from 'src/tools/TaskOutputTool/TaskOutputTool.js';
import { TaskStopTool } from 'src/tools/TaskStopTool/TaskStopTool.js';
import { TodoWriteTool } from 'src/tools/TodoWriteTool/TodoWriteTool.js';
import { TungstenTool } from 'src/tools/TungstenTool/TungstenTool.js';
import { WebFetchTool } from 'src/tools/WebFetchTool/WebFetchTool.js';
import { WebSearchTool } from 'src/tools/WebSearchTool/WebSearchTool.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { count } from '../../utils/array.js';
import { plural } from '../../utils/stringUtils.js';
import { Divider } from '../design-system/Divider.js';
type Props = {
  tools: Tools;
  initialTools: string[] | undefined;
  onComplete: (selectedTools: string[] | undefined) => void;
  onCancel?: () => void;
};
type ToolBucket = {
  name: string;
  toolNames: Set<string>;
  isMcp?: boolean;
};
type ToolBuckets = {
  READ_ONLY: ToolBucket;
  EDIT: ToolBucket;
  EXECUTION: ToolBucket;
  MCP: ToolBucket;
  OTHER: ToolBucket;
};
function getToolBuckets(): ToolBuckets {
  return {
    READ_ONLY: {
      name: 'Read-only tools',
      toolNames: new Set([GlobTool.name, GrepTool.name, ExitPlanModeV2Tool.name, FileReadTool.name, WebFetchTool.name, TodoWriteTool.name, WebSearchTool.name, TaskStopTool.name, TaskOutputTool.name, ListMcpResourcesTool.name, ReadMcpResourceTool.name])
    },
    EDIT: {
      name: 'Edit tools',
      toolNames: new Set([FileEditTool.name, FileWriteTool.name, NotebookEditTool.name])
    },
    EXECUTION: {
      name: 'Execution tools',
      toolNames: new Set([BashTool.name, process.env.USER_TYPE === 'ant' ? (TungstenTool as any)?.name : undefined].filter(n => n !== undefined))
    },
    MCP: {
      name: 'MCP tools',
      toolNames: new Set(),
      // Dynamic - no static list
      isMcp: true
    },
    OTHER: {
      name: 'Other tools',
      toolNames: new Set() // Dynamic - catch-all for uncategorized tools
    }
  };
}

// Helper to get MCP server buckets dynamically
function getMcpServerBuckets(tools: Tools): Array<{
  serverName: string;
  tools: Tools;
}> {
  const serverMap = new Map<string, Tool[]>();
  tools.forEach(tool => {
    if (isMcpTool(tool)) {
      const mcpInfo = mcpInfoFromString(tool.name);
      if (mcpInfo?.serverName) {
        const existing = serverMap.get(mcpInfo.serverName) || [];
        existing.push(tool);
        serverMap.set(mcpInfo.serverName, existing);
      }
    }
  });
  return Array.from(serverMap.entries()).map(([serverName, tools]) => ({
    serverName,
    tools
  })).sort((a, b) => a.serverName.localeCompare(b.serverName));
}
export function ToolSelector({ tools, initialTools, onComplete, onCancel }: Props) {
  const customAgentTools = useMemo(() => filterToolsForAgent({
    tools,
    isBuiltIn: false,
    isAsync: false
  }), [tools]);
  const expandedInitialTools = useMemo(() => !initialTools || initialTools.includes("*") ? customAgentTools.map(tool => tool.name) : initialTools, [customAgentTools, initialTools]);
  const [selectedTools, setSelectedTools] = useState(expandedInitialTools);
  const [focusIndex, setFocusIndex] = useState(0);
  const [showIndividualTools, setShowIndividualTools] = useState(false);
  const toolNames = useMemo(() => new Set(customAgentTools.map(tool => tool.name)), [customAgentTools]);
  const validSelectedTools = useMemo(() => selectedTools.filter(name => toolNames.has(name)), [selectedTools, toolNames]);
  const selectedSet = useMemo(() => new Set(validSelectedTools), [validSelectedTools]);
  const isAllSelected = validSelectedTools.length === customAgentTools.length && customAgentTools.length > 0;
  const handleToggleTool = useCallback((toolName: string | undefined) => {
    if (!toolName) {
      return;
    }
    setSelectedTools(current => current.includes(toolName) ? current.filter(t => t !== toolName) : [...current, toolName]);
  }, []);
  const handleToggleTools = useCallback((toolNames: string[], select: boolean) => {
    setSelectedTools(current => {
      if (select) {
        const toolsToAdd = toolNames.filter(t => !current.includes(t));
        return [...current, ...toolsToAdd];
      } else {
        return current.filter(t => !toolNames.includes(t));
      }
    });
  }, []);
  const handleConfirm = useCallback(() => {
    const allToolNames = customAgentTools.map(tool => tool.name);
    const areAllToolsSelected = validSelectedTools.length === allToolNames.length && allToolNames.every(name => validSelectedTools.includes(name));
    const finalTools = areAllToolsSelected ? undefined : validSelectedTools;
    onComplete(finalTools);
  }, [customAgentTools, onComplete, validSelectedTools]);
  const toolsByBucket = useMemo(() => {
    const toolBuckets = getToolBuckets();
    const buckets = {
      readOnly: [] as Tool[],
      edit: [] as Tool[],
      execution: [] as Tool[],
      mcp: [] as Tool[],
      other: [] as Tool[]
    };
    customAgentTools.forEach(tool => {
      if (isMcpTool(tool)) {
        buckets.mcp.push(tool);
      } else if (toolBuckets.READ_ONLY.toolNames.has(tool.name)) {
        buckets.readOnly.push(tool);
      } else if (toolBuckets.EDIT.toolNames.has(tool.name)) {
        buckets.edit.push(tool);
      } else if (toolBuckets.EXECUTION.toolNames.has(tool.name)) {
        buckets.execution.push(tool);
      } else if (tool.name !== AGENT_TOOL_NAME) {
        buckets.other.push(tool);
      }
    });
    return buckets;
  }, [customAgentTools]);
  const createBucketToggleAction = useCallback((bucketTools: Tool[]) => {
    const selected = count(bucketTools, (t: any) => selectedSet.has(t.name));
    const needsSelection = selected < bucketTools.length;
    return () => {
      const toolNames = bucketTools.map(tool => tool.name);
      handleToggleTools(toolNames, needsSelection);
    };
  }, [selectedSet]);
  const navigableItems = useMemo(() => {
    const items: Array<{
      id: string;
      label: string;
      action: () => void;
      isContinue?: boolean;
      isToggle?: boolean;
      isHeader?: boolean;
    }> = [];
    items.push({
      id: "continue",
      label: "Continue",
      action: handleConfirm,
      isContinue: true
    });
    items.push({
      id: "bucket-all",
      label: `${isAllSelected ? figures.checkboxOn : figures.checkboxOff} All tools`,
      action: () => {
        const allToolNames = customAgentTools.map(tool => tool.name);
        handleToggleTools(allToolNames, !isAllSelected);
      }
    });
    const toolBuckets = getToolBuckets();
    const bucketConfigs = [{
      id: "bucket-readonly",
      name: toolBuckets.READ_ONLY.name,
      tools: toolsByBucket.readOnly
    }, {
      id: "bucket-edit",
      name: toolBuckets.EDIT.name,
      tools: toolsByBucket.edit
    }, {
      id: "bucket-execution",
      name: toolBuckets.EXECUTION.name,
      tools: toolsByBucket.execution
    }, {
      id: "bucket-mcp",
      name: toolBuckets.MCP.name,
      tools: toolsByBucket.mcp
    }, {
      id: "bucket-other",
      name: toolBuckets.OTHER.name,
      tools: toolsByBucket.other
    }];
    bucketConfigs.forEach(({ id, name, tools: bucketTools }) => {
      if (bucketTools.length === 0) {
        return;
      }
      const selected = count(bucketTools, (t: any) => selectedSet.has(t.name));
      const isFullySelected = selected === bucketTools.length;
      items.push({
        id,
        label: `${isFullySelected ? figures.checkboxOn : figures.checkboxOff} ${name}`,
        action: createBucketToggleAction(bucketTools)
      });
    });
    const toggleButtonIndex = items.length;
    items.push({
      id: "toggle-individual",
      label: showIndividualTools ? "Hide advanced options" : "Show advanced options",
      action: () => {
        setShowIndividualTools(!showIndividualTools);
        if (showIndividualTools && focusIndex > toggleButtonIndex) {
          setFocusIndex(toggleButtonIndex);
        }
      },
      isToggle: true
    });
    const mcpServerBuckets = getMcpServerBuckets(customAgentTools);
    if (showIndividualTools) {
      if (mcpServerBuckets.length > 0) {
        items.push({
          id: "mcp-servers-header",
          label: "MCP Servers:",
          action: () => {},
          isHeader: true
        });
        mcpServerBuckets.forEach(({ serverName, tools: serverTools }) => {
          const selected = count(serverTools, t => selectedSet.has(t.name));
          const isFullySelected = selected === serverTools.length;
          items.push({
            id: `mcp-server-${serverName}`,
            label: `${isFullySelected ? figures.checkboxOn : figures.checkboxOff} ${serverName} (${serverTools.length} ${plural(serverTools.length, "tool")})`,
            action: () => {
              const toolNames = serverTools.map(tool => tool.name);
              handleToggleTools(toolNames, !isFullySelected);
            }
          });
        });
        items.push({
          id: "tools-header",
          label: "Individual Tools:",
          action: () => {},
          isHeader: true
        });
      }
      customAgentTools.forEach(tool => {
        let displayName = tool.name;
        if (tool.name.startsWith("mcp__")) {
          const mcpInfo = mcpInfoFromString(tool.name);
          displayName = mcpInfo ? `${mcpInfo.toolName} (${mcpInfo.serverName})` : tool.name;
        }
        items.push({
          id: `tool-${tool.name}`,
          label: `${selectedSet.has(tool.name) ? figures.checkboxOn : figures.checkboxOff} ${displayName}`,
          action: () => handleToggleTool(tool.name)
        });
      });
    }
    return items;
  }, [createBucketToggleAction, customAgentTools, focusIndex, handleConfirm, isAllSelected, selectedSet, showIndividualTools, toolsByBucket.edit, toolsByBucket.execution, toolsByBucket.mcp, toolsByBucket.other, toolsByBucket.readOnly]);
  const handleCancel = useCallback(() => {
    if (onCancel) {
      onCancel();
    } else {
      onComplete(initialTools);
    }
  }, [initialTools, onCancel, onComplete]);
  useKeybinding("confirm:no", handleCancel, {
    context: "Confirmation"
  });
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "return") {
      e.preventDefault();
      const item = navigableItems[focusIndex];
      if (item && !item.isHeader) {
        item.action();
      }
    } else if (e.key === "up") {
      e.preventDefault();
      let newIndex = focusIndex - 1;
      while (newIndex > 0 && navigableItems[newIndex]?.isHeader) {
        newIndex--;
      }
      setFocusIndex(Math.max(0, newIndex));
    } else if (e.key === "down") {
      e.preventDefault();
      let newIndex = focusIndex + 1;
      while (newIndex < navigableItems.length - 1 && navigableItems[newIndex]?.isHeader) {
        newIndex++;
      }
      setFocusIndex(Math.min(navigableItems.length - 1, newIndex));
    }
  }, [focusIndex, navigableItems]);
  return <Box flexDirection="column" marginTop={1} tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>
    <Text color={focusIndex === 0 ? "suggestion" : undefined} bold={focusIndex === 0}>{focusIndex === 0 ? `${figures.pointer} ` : "  "}[ Continue ]</Text>
    <Divider width={40} />
    {navigableItems.slice(1).map((item, index) => {
      const isCurrentlyFocused = index + 1 === focusIndex;
      const isToggleButton = item.isToggle;
      const isHeader = item.isHeader;
      return <React.Fragment key={item.id}>{isToggleButton && <Divider width={40} />}{isHeader && index > 0 && <Box marginTop={1} />}<Text color={isHeader ? undefined : isCurrentlyFocused ? "suggestion" : undefined} dimColor={isHeader} bold={isToggleButton && isCurrentlyFocused}>{isHeader ? "" : isCurrentlyFocused ? `${figures.pointer} ` : "  "}{isToggleButton ? `[ ${item.label} ]` : item.label}</Text></React.Fragment>;
    })}
    <Box marginTop={1} flexDirection="column"><Text dimColor={true}>{isAllSelected ? "All tools selected" : `${selectedSet.size} of ${customAgentTools.length} tools selected`}</Text></Box>
  </Box>;
}
