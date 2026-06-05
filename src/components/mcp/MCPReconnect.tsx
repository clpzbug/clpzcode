import figures from 'figures';
import React, { useEffect, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Box, color, Text, useTheme } from '../../ink.js';
import { useMcpReconnect } from '../../services/mcp/MCPConnectionManager.js';
import { useAppStateStore } from '../../state/AppState.js';
import { Spinner } from '../Spinner.js';
type Props = {
  serverName: string;
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
export function MCPReconnect({ serverName, onComplete }: Props) {
  const [theme] = useTheme();
  const store = useAppStateStore();
  const reconnectMcpServer = useMcpReconnect();
  const [isReconnecting, setIsReconnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const attemptReconnect = async function attemptReconnect() {
      try {
        const server = store.getState().mcp.clients.find(c => c.name === serverName);
        if (!server) {
          setError(`MCP server "${serverName}" not found`);
          setIsReconnecting(false);
          onComplete(`MCP server "${serverName}" not found`);
          return;
        }
        const result = await reconnectMcpServer(serverName);
        switch (result.client.type) {
          case "connected":
            {
              setIsReconnecting(false);
              onComplete(`Successfully reconnected to ${serverName}`);
              break;
            }
          case "needs-auth":
            {
              setError(`${serverName} requires authentication`);
              setIsReconnecting(false);
              onComplete(`${serverName} requires authentication. Use /mcp to authenticate.`);
              break;
            }
          case "pending":
          case "failed":
          case "disabled":
            {
              setError(`Failed to reconnect to ${serverName}`);
              setIsReconnecting(false);
              onComplete(`Failed to reconnect to ${serverName}`);
            }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        setIsReconnecting(false);
        onComplete(`Error: ${errorMessage}`);
      }
    };
    attemptReconnect();
  }, [serverName, reconnectMcpServer, store, onComplete]);
  if (isReconnecting) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text color="text">Reconnecting to <Text bold={true}>{serverName}</Text></Text>
        <Box><Spinner /><Text> Establishing connection to MCP server</Text></Box>
      </Box>
    );
  }
  if (error) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box>
          <Text>{color("error", theme)(figures.cross)} </Text>
          <Text color="error">Failed to reconnect to {serverName}</Text>
        </Box>
        <Text dimColor={true}>Error: {error}</Text>
      </Box>
    );
  }
  return null;
}
