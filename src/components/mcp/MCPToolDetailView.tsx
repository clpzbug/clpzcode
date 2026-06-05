import React from 'react';
import { Box, Text } from '../../ink.js';
import { extractMcpToolDisplayName, getMcpDisplayName } from '../../services/mcp/mcpStringUtils.js';
import type { Tool } from '../../Tool.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Dialog } from '../design-system/Dialog.js';
import type { ServerInfo } from './types.js';
type Props = {
  tool: Tool;
  server: ServerInfo;
  onBack: () => void;
};
export function MCPToolDetailView({ tool, server, onBack }: Props) {
  const [toolDescription, setToolDescription] = React.useState("");
  const toolName = getMcpDisplayName(tool.name, server.name);
  const fullDisplayName = tool.userFacingName ? tool.userFacingName({}) : toolName;
  const displayName = extractMcpToolDisplayName(fullDisplayName);
  const isReadOnly = tool.isReadOnly?.({}) ?? false;
  const isDestructive = tool.isDestructive?.({}) ?? false;
  const isOpenWorld = tool.isOpenWorld?.({}) ?? false;
  React.useEffect(() => {
    const loadDescription = async function loadDescription() {
      try {
        const desc = await tool.description({}, {
          isNonInteractiveSession: false,
          toolPermissionContext: {
            mode: "default" as const,
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false
          },
          tools: []
        });
        setToolDescription(desc);
      } catch {
        setToolDescription("Failed to load description");
      }
    };
    loadDescription();
  }, [tool]);
  const titleContent = <>{displayName}{isReadOnly && <Text color="success"> [read-only]</Text>}{isDestructive && <Text color="error"> [destructive]</Text>}{isOpenWorld && <Text dimColor={true}> [open-world]</Text>}</>;
  return (
    <Dialog title={titleContent} subtitle={server.name} onCancel={onBack} inputGuide={_temp}>
      <Box flexDirection="column">
        <Box><Text bold={true}>Tool name: </Text><Text dimColor={true}>{toolName}</Text></Box>
        <Box><Text bold={true}>Full name: </Text><Text dimColor={true}>{tool.name}</Text></Box>
        {toolDescription && <Box flexDirection="column" marginTop={1}><Text bold={true}>Description:</Text><Text wrap="wrap">{toolDescription}</Text></Box>}
        {tool.inputJSONSchema && tool.inputJSONSchema.properties && Object.keys(tool.inputJSONSchema.properties).length > 0 && <Box flexDirection="column" marginTop={1}><Text bold={true}>Parameters:</Text><Box marginLeft={2} flexDirection="column">{Object.entries(tool.inputJSONSchema.properties).map(([key, value]) => {
          const required = tool.inputJSONSchema?.required as string[] | undefined;
          const isRequired = required?.includes(key);
          return <Text key={key}>• {key}{isRequired && <Text dimColor={true}> (required)</Text>}:{" "}<Text dimColor={true}>{typeof value === "object" && value && "type" in value ? String(value.type) : "unknown"}</Text>{typeof value === "object" && value && "description" in value && <Text dimColor={true}> - {String(value.description)}</Text>}</Text>;
        })}</Box></Box>}
      </Box>
    </Dialog>
  );
}
function _temp(exitState) {
  return exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />;
}
