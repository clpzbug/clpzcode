import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { isTerminalTaskStatus } from '../../Task.js'
import { setRunNodeStatus } from '../../tools/WorkflowTool/workflowsStore.js'
import { workflowsBaseDir } from '../../tools/WorkflowTool/persistence.js'

export type LocalWorkflowAgentState = {
  id: string
  subtask: string
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  result?: string
}

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  summary?: string
  /** Persistence run id (WorkflowRunRecord.runId) — lets skip/retry update the on-disk
   *  record that `/workflows resume` reads. Distinct from the task id. */
  runId?: string
  agents: LocalWorkflowAgentState[]
  /** Aborts the live engine run. A status flip alone does not stop in-flight
   *  agents — the engine only honors deps.signal — so kill must abort this. */
  abortController?: AbortController
}

export function killWorkflowTask(taskId: string, setAppState: SetAppState): Promise<void> {
  let controller: AbortController | undefined
  setAppState(state => {
    const task = state.tasks[taskId]
    if (task?.type !== 'local_workflow' || isTerminalTaskStatus(task.status)) return state
    controller = task.abortController
    return {
      ...state,
      tasks: {
        ...state.tasks,
        [taskId]: { ...task, status: 'killed' as const, endTime: Date.now() },
      },
    }
  })
  // Actually halt the running engine (status flip alone is a no-op on live agents).
  controller?.abort()
  return Promise.resolve()
}

// Status the on-disk record gets for each UI action. 'running' has no persisted form,
// and a retried node is persisted 'pending' so `/workflows resume` re-runs it.
const PERSISTED_STATUS = { skipped: 'skipped', pending: 'pending' } as const

/** Set one workflow agent node's status in the UI task state AND persist it to the
 *  on-disk WorkflowRunRecord (via the task's runId) so `/workflows resume` honors it.
 *  No-op if the task isn't a local_workflow or the agent id is absent. */
function setAgentStatus(
  taskId: string,
  agentId: string,
  status: 'skipped' | 'pending',
  setAppState: SetAppState,
): void {
  let runId: string | undefined
  setAppState(state => {
    const task = state.tasks[taskId]
    if (task?.type !== 'local_workflow') return state
    if (!task.agents.some(a => a.id === agentId)) return state
    runId = task.runId
    return {
      ...state,
      tasks: {
        ...state.tasks,
        [taskId]: {
          ...task,
          agents: task.agents.map(a => (a.id === agentId ? { ...a, status } : a)),
        },
      },
    }
  })
  // Persist so the change survives to the next resume (the resume driver reads disk).
  if (runId) {
    try {
      setRunNodeStatus(workflowsBaseDir(), runId, agentId, PERSISTED_STATUS[status], Date.now())
    } catch {
      // Persistence is best-effort; the UI status update already applied.
    }
  }
}

/** Skip a node: mark it 'skipped' (UI + persisted). On the next `/workflows resume`, a
 *  skipped node is seeded as settled, so the engine does NOT re-run it. */
export function skipWorkflowAgent(taskId: string, agentId: string, setAppState: SetAppState): void {
  setAgentStatus(taskId, agentId, 'skipped', setAppState)
}

/** Retry a node: mark it 'pending' (UI + persisted). `/workflows resume <id>` re-runs
 *  pending/error nodes, so the retried node re-runs (completed nodes are reused). */
export function retryWorkflowAgent(taskId: string, agentId: string, setAppState: SetAppState): void {
  setAgentStatus(taskId, agentId, 'pending', setAppState)
}

export const LocalWorkflowTask: Task = {
  name: 'local_workflow',
  type: 'local_workflow',
  async kill(taskId: string, setAppState: SetAppState): Promise<void> {
    await killWorkflowTask(taskId, setAppState)
  },
}
