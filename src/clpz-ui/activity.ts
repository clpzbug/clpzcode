// Renderer-agnostic projection of the live task registry (AppState.tasks) into a
// flat list the clpzcode TUI can render in the activity footer pill and panel.
// No OpenTUI imports here — pure data so it stays testable and reusable.

import type { TaskStatus } from 'src/Task.js'
import { isPanelAgentTask, type LocalAgentTaskState } from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import type { LocalShellTaskState } from 'src/tasks/LocalShellTask/guards.js'
import type { LocalWorkflowTaskState } from 'src/tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { TaskState } from 'src/tasks/types.js'

export type ActivityKind =
  | 'agent'
  | 'workflow'
  | 'shell'
  | 'monitor'
  | 'teammate'
  | 'remote'
  | 'dream'
  | 'mcp'

export type ActivityItem = {
  /** TaskStateBase.id — also the kill key passed to stopTask. */
  id: string
  kind: ActivityKind
  title: string
  detail?: string
  status: TaskStatus
  /** Resolved model the unit runs on (agents only), e.g. "opus", "grok-4.3". */
  model?: string
  /** Live token count (agents only; undefined for sources with no attribution). */
  tokens?: number
  toolUses?: number
  /** Workflows: running / total child agent nodes. */
  childRunning?: number
  childTotal?: number
  startTime: number
  endTime?: number
  /** Whether a kill action is meaningful for this row right now. */
  killable: boolean
}

function agentDetail(t: LocalAgentTaskState): string | undefined {
  if (t.progress?.summary) return t.progress.summary
  const a = t.progress?.lastActivity
  return a?.activityDescription ?? a?.toolName
}

/** Map one task into an ActivityItem, or null for types we don't surface. */
export function toActivityItem(task: TaskState): ActivityItem | null {
  const base = {
    id: task.id,
    status: task.status,
    startTime: task.startTime,
    endTime: task.endTime,
    killable: task.status === 'running',
  }
  switch (task.type) {
    case 'local_agent': {
      const t = task as LocalAgentTaskState
      return {
        ...base,
        kind: 'agent',
        title: t.description,
        detail: agentDetail(t),
        model: t.model,
        tokens: t.progress?.tokenCount,
        toolUses: t.progress?.toolUseCount,
      }
    }
    case 'local_bash': {
      const t = task as LocalShellTaskState
      const monitor = t.kind === 'monitor'
      return {
        ...base,
        kind: monitor ? 'monitor' : 'shell',
        title: monitor ? t.description : t.command,
      }
    }
    case 'local_workflow': {
      const t = task as LocalWorkflowTaskState
      const agents = t.agents ?? []
      return {
        ...base,
        kind: 'workflow',
        title: t.summary ?? t.description,
        // Per-workflow token attribution does not exist (cost is session-wide),
        // so we surface node progress instead of a misleading number.
        childRunning: agents.filter(a => a.status === 'running').length,
        childTotal: agents.length,
      }
    }
    case 'remote_agent':
      return { ...base, kind: 'remote', title: (task as { title?: string }).title ?? task.description }
    case 'in_process_teammate': {
      const name = (task as { identity?: { agentName?: string } }).identity?.agentName
      return { ...base, kind: 'teammate', title: name ? `@${name}` : task.description }
    }
    case 'monitor_mcp':
      return { ...base, kind: 'mcp', title: task.description }
    case 'dream':
      return { ...base, kind: 'dream', title: task.description }
    default:
      return null
  }
}

function byRunningThenRecent(a: ActivityItem, b: ActivityItem): number {
  if (a.status === 'running' && b.status !== 'running') return -1
  if (a.status !== 'running' && b.status === 'running') return 1
  return b.startTime - a.startTime
}

/**
 * Project the task registry into the activity list.
 *
 * Unlike isBackgroundTask (which hides foreground tasks), this surfaces ANY
 * running/pending unit the user spawned — foreground sub-agents and shells
 * included — because the user wants the indicator visible "whenever agents,
 * workflows or shells are spawned". The leader's own main session is excluded.
 */
export function selectActivityItems(
  tasks: Record<string, TaskState> | undefined,
): ActivityItem[] {
  const items: ActivityItem[] = []
  for (const task of Object.values(tasks ?? {})) {
    if (task.status !== 'running' && task.status !== 'pending') continue
    if (task.type === 'local_agent' && !isPanelAgentTask(task)) continue
    const item = toActivityItem(task)
    if (item) items.push(item)
  }
  return items.sort(byRunningThenRecent)
}

export function runningCount(items: ActivityItem[]): number {
  let n = 0
  for (const it of items) if (it.status === 'running') n++
  return n
}

/** Sum of known per-item tokens (agents). Sources without attribution add 0. */
export function aggregateTokens(items: ActivityItem[]): number {
  let n = 0
  for (const it of items) n += it.tokens ?? 0
  return n
}
