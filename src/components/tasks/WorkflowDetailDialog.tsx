import * as React from 'react'
import { Box, Text, useInput } from '../../ink.js'
import { GLYPH } from '../../tui/design/index.js'
import type { Theme } from '../../utils/theme.js'
import type {
  LocalWorkflowAgentState,
  LocalWorkflowTaskState,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'

type Props = {
  workflow: LocalWorkflowTaskState
  onDone: () => void
  onKill?: () => void
  onSkipAgent?: (agentId: string) => void
  onRetryAgent?: (agentId: string) => void
  onBack: () => void
}

type AgentStatus = LocalWorkflowAgentState['status']

// Status glyph + theme color per node state. Reads as a clean status tree.
const NODE_STYLE: Record<AgentStatus, { glyph: string; color?: keyof Theme; dim?: boolean }> = {
  done: { glyph: GLYPH.done, color: 'success' }, // ✓ (light, matches the feed)
  running: { glyph: '◐', color: 'permission' },
  error: { glyph: GLYPH.toolError, color: 'error' }, // ✕
  skipped: { glyph: '⊘', dim: true }, // genuinely distinct state — kept
  pending: { glyph: GLYPH.pending, dim: true }, // ◦
}

function counts(agents: LocalWorkflowAgentState[]): Record<AgentStatus, number> {
  const c: Record<AgentStatus, number> = { done: 0, running: 0, error: 0, skipped: 0, pending: 0 }
  for (const a of agents) c[a.status]++
  return c
}

export function WorkflowDetailDialog({ workflow, onBack, onSkipAgent, onRetryAgent }: Props) {
  const agents = workflow.agents ?? []
  const c = counts(agents)
  const [selected, setSelected] = React.useState(0)
  const interactive = Boolean(onSkipAgent || onRetryAgent) && agents.length > 0

  useInput((input, key) => {
    if (key.escape) return onBack()
    if (!interactive) return
    if (key.upArrow) setSelected(i => (i > 0 ? i - 1 : agents.length - 1))
    else if (key.downArrow) setSelected(i => (i < agents.length - 1 ? i + 1 : 0))
    else if (input === 's') {
      // Skip a not-yet-settled node (pending/running/error).
      const a = agents[selected]
      if (a && a.status !== 'done' && a.status !== 'skipped') onSkipAgent?.(a.id)
    } else if (input === 'r') {
      // Retry a failed/skipped node (re-queues it for the next resume).
      const a = agents[selected]
      if (a && (a.status === 'error' || a.status === 'skipped')) onRetryAgent?.(a.id)
    }
  })

  // Compact progress line — only show the buckets that have nodes.
  const progress = (['done', 'running', 'error', 'pending', 'skipped'] as const)
    .filter(s => c[s] > 0)
    .map(s => `${NODE_STYLE[s].glyph} ${c[s]}`)
    .join('  ')

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold color="permission">Workflow</Text>
          <Text>{workflow.summary ?? workflow.description}</Text>
        </Box>
        <Box gap={2}>
          <Text dimColor>{agents.length} node{agents.length === 1 ? '' : 's'} · {workflow.status}</Text>
          {progress ? <Text dimColor>{progress}</Text> : null}
        </Box>
      </Box>

      <Box flexDirection="column">
        {agents.map((agent, i) => {
          const st = NODE_STYLE[agent.status]
          const isSel = interactive && i === selected
          return (
            <Box key={agent.id} gap={1}>
              <Text color={isSel ? 'permission' : undefined} dimColor={!isSel}>{isSel ? '❯' : ' '}</Text>
              <Text color={st.color} dimColor={st.dim}>{st.glyph}</Text>
              <Text dimColor={agent.status === 'pending' || agent.status === 'skipped'}>
                {agent.subtask}
              </Text>
              {agent.status === 'running' ? <Text dimColor>· running</Text> : null}
              {agent.status === 'error' ? <Text color="error">· failed</Text> : null}
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {interactive ? '↑/↓ select · s skip · r retry · ' : ''}← Esc to go back
        </Text>
      </Box>
    </Box>
  )
}
