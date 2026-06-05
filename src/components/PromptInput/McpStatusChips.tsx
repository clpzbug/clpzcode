import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import {
  STATUS_DOT,
  type StatusKind,
  statusDotRole,
} from '../../tui/design/glyphs.js'
import { role } from '../../tui/design/tokens.js'

// Map an MCP connection state to a terminal status-dot kind. 'pending' is a
// transient connecting state with no terminal dot, so it borrows the faint
// 'disabled' dot until it resolves.
function kindFor(type: MCPServerConnection['type']): StatusKind {
  switch (type) {
    case 'connected':
      return 'connected'
    case 'failed':
      return 'failed'
    case 'needs-auth':
      return 'needsAuth'
    default:
      return 'disabled' // 'pending' | 'disabled'
  }
}

type Props = { mcpClients?: MCPServerConnection[] }

/**
 * opencode-style MCP status chips: one `<dot> name` per configured MCP server,
 * excluding the built-in `ide` client (its selection is shown separately by
 * IdeStatusIndicator). The dot COLOR is the only signal — connected = ok,
 * failed = error, needs-auth = warn, pending/disabled = faint — keeping the
 * single-accent Zen rule. Renders nothing when there are no such servers, so
 * it is invisible for users without MCP servers.
 */
export function McpStatusChips({ mcpClients }: Props): React.ReactNode {
  const servers = (mcpClients ?? []).filter(c => c.name !== 'ide')
  if (servers.length === 0) return null
  return (
    <Box flexDirection="row" gap={1}>
      {servers.map(c => {
        const kind = kindFor(c.type)
        return (
          <Text key={c.name} color={role(statusDotRole(kind))} wrap="truncate">
            {STATUS_DOT[kind]} {c.name}
          </Text>
        )
      })}
    </Box>
  )
}
