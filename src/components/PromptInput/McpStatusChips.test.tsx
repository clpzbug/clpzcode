import { describe, expect, it } from 'bun:test'
import { renderToString } from '../../utils/staticRender.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import { STATUS_DOT } from '../../tui/design/glyphs.js'
import { McpStatusChips } from './McpStatusChips.js'

// Minimal stub — McpStatusChips only reads `name` and `type`.
function server(name: string, type: MCPServerConnection['type']): MCPServerConnection {
  return { name, type } as unknown as MCPServerConnection
}

describe('McpStatusChips', () => {
  it('renders one state-coded dot+name per non-ide server, excluding ide', async () => {
    const out = await renderToString(
      <McpStatusChips
        mcpClients={[
          server('github', 'connected'),
          server('sentry', 'failed'),
          server('linear', 'needs-auth'),
          server('ide', 'connected'), // built-in client — must be excluded
        ]}
      />,
      80,
    )
    expect(out).toContain(`${STATUS_DOT.connected} github`)
    expect(out).toContain(`${STATUS_DOT.failed} sentry`)
    expect(out).toContain(`${STATUS_DOT.needsAuth} linear`)
    expect(out).not.toContain('ide')
  })

  it('renders nothing when the only server is the ide client', async () => {
    const out = await renderToString(
      <McpStatusChips mcpClients={[server('ide', 'connected')]} />,
      80,
    )
    expect(out).not.toContain(STATUS_DOT.connected)
  })

  it('renders nothing for no servers', async () => {
    const out = await renderToString(<McpStatusChips mcpClients={[]} />, 80)
    expect(out).not.toContain(STATUS_DOT.connected)
    expect(out).not.toContain(STATUS_DOT.failed)
  })
})
