import React, { useEffect, useMemo } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { ClaudeAuthProvider } from '../../services/mcp/auth.js';
import type { McpClaudeAIProxyServerConfig, McpHTTPServerConfig, McpSSEServerConfig, McpStdioServerConfig } from '../../services/mcp/types.js';
import { extractAgentMcpServers, filterToolsByServer } from '../../services/mcp/utils.js';
import { useAppState } from '../../state/AppState.js';
import { getSessionIngressAuthToken } from '../../utils/sessionIngressAuth.js';
import { MCPAgentServerMenu } from './MCPAgentServerMenu.js';
import { MCPListPanel } from './MCPListPanel.js';
import { MCPRemoteServerMenu } from './MCPRemoteServerMenu.js';
import { MCPStdioServerMenu } from './MCPStdioServerMenu.js';
import { MCPToolDetailView } from './MCPToolDetailView.js';
import { MCPToolListView } from './MCPToolListView.js';
import type { AgentMcpServerInfo, MCPViewState, ServerInfo } from './types.js';
type Props = {
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
export function MCPSettings({ onComplete }: Props) {
  const mcp = useAppState(s => s.mcp);
  const agentDefinitions = useAppState(s => s.agentDefinitions);
  const mcpClients = mcp.clients;
  const [viewState, setViewState] = React.useState<MCPViewState>({
    type: "list"
  });
  const [servers, setServers] = React.useState<ServerInfo[]>([]);
  const agentMcpServers = useMemo(() => extractAgentMcpServers(agentDefinitions.allAgents), [agentDefinitions.allAgents]);
  const filteredClients = useMemo(() => mcpClients.filter(client => client.name !== "ide").sort((a, b) => a.name.localeCompare(b.name)), [mcpClients]);
  useEffect(() => {
    let cancelled = false;
    const prepareServers = async function prepareServers() {
      const serverInfos = await Promise.all(filteredClients.map(async client_0 => {
        const scope = client_0.config.scope;
        const isSSE = client_0.config.type === "sse";
        const isHTTP = client_0.config.type === "http";
        const isClaudeAIProxy = client_0.config.type === "claudeai-proxy";
        let isAuthenticated = undefined;
        if (isSSE || isHTTP) {
          const authProvider = new ClaudeAuthProvider(client_0.name, client_0.config as McpSSEServerConfig | McpHTTPServerConfig);
          const tokens = await authProvider.tokens();
          const hasSessionAuth = getSessionIngressAuthToken() !== null && client_0.type === "connected";
          const hasToolsAndConnected = client_0.type === "connected" && filterToolsByServer(mcp.tools, client_0.name).length > 0;
          isAuthenticated = (Boolean(tokens) || hasSessionAuth || hasToolsAndConnected) as any;
        }
        const baseInfo = {
          name: client_0.name,
          client: client_0,
          scope
        };
        if (isClaudeAIProxy) {
          return {
            ...baseInfo,
            transport: "claudeai-proxy" as const,
            isAuthenticated: false,
            config: client_0.config as McpClaudeAIProxyServerConfig
          };
        } else {
          if (isSSE) {
            return {
              ...baseInfo,
              transport: "sse" as const,
              isAuthenticated,
              config: client_0.config as McpSSEServerConfig
            };
          } else {
            if (isHTTP) {
              return {
                ...baseInfo,
                transport: "http" as const,
                isAuthenticated,
                config: client_0.config as McpHTTPServerConfig
              };
            } else {
              return {
                ...baseInfo,
                transport: "stdio" as const,
                config: client_0.config as McpStdioServerConfig
              };
            }
          }
        }
      }));
      if (cancelled) {
        return;
      }
      setServers(serverInfos);
    };
    prepareServers();
    return () => {
      cancelled = true;
    };
  }, [filteredClients, mcp.tools]);
  useEffect(() => {
    if (servers.length === 0 && filteredClients.length > 0) {
      return;
    }
    if (servers.length === 0 && agentMcpServers.length === 0) {
      onComplete("No MCP servers configured. Please run /doctor if this is unexpected. Otherwise, run `clpzcode mcp --help` or visit https://github.com/clpzbug/clpzcode to learn more.");
    }
  }, [servers.length, filteredClients.length, agentMcpServers.length, onComplete]);
  switch (viewState.type) {
    case "list":
      {
        return <MCPListPanel servers={servers} agentServers={agentMcpServers} onSelectServer={server => setViewState({
          type: "server-menu",
          server
        })} onSelectAgentServer={agentServer => setViewState({
          type: "agent-server-menu",
          agentServer
        })} onComplete={onComplete} defaultTab={viewState.defaultTab} />;
      }
    case "server-menu":
      {
        const serverTools_0 = filterToolsByServer(mcp.tools, viewState.server.name);
        const defaultTab = viewState.server.transport === "claudeai-proxy" ? "claude.ai" : "Claude Code";
        if (viewState.server.transport === "stdio") {
          const onViewTools = () => setViewState({
            type: "server-tools",
            server: viewState.server
          });
          const onCancel = () => setViewState({
            type: "list",
            defaultTab
          });
          return <MCPStdioServerMenu server={viewState.server} serverToolsCount={serverTools_0.length} onViewTools={onViewTools} onCancel={onCancel} onComplete={onComplete} />;
        } else {
          const onViewTools = () => setViewState({
            type: "server-tools",
            server: viewState.server
          });
          const onCancel = () => setViewState({
            type: "list",
            defaultTab
          });
          return <MCPRemoteServerMenu server={viewState.server} serverToolsCount={serverTools_0.length} onViewTools={onViewTools} onCancel={onCancel} onComplete={onComplete} />;
        }
      }
    case "server-tools":
      {
        return <MCPToolListView server={viewState.server} onSelectTool={(_, index) => setViewState({
          type: "server-tool-detail",
          server: viewState.server,
          toolIndex: index
        })} onBack={() => setViewState({
          type: "server-menu",
          server: viewState.server
        })} />;
      }
    case "server-tool-detail":
      {
        const serverTools = filterToolsByServer(mcp.tools, viewState.server.name);
        const tool = serverTools[viewState.toolIndex];
        if (!tool) {
          setViewState({
            type: "server-tools",
            server: viewState.server
          });
          return null;
        }
        const onBack = () => setViewState({
          type: "server-tools",
          server: viewState.server
        });
        return <MCPToolDetailView tool={tool} server={viewState.server} onBack={onBack} />;
      }
    case "agent-server-menu":
      {
        const onCancel = () => setViewState({
          type: "list",
          defaultTab: "Agents"
        });
        return <MCPAgentServerMenu agentServer={viewState.agentServer} onCancel={onCancel} onComplete={onComplete} />;
      }
  }
}
