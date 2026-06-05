// src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  skipWorkflowAgent,
  retryWorkflowAgent,
  type LocalWorkflowTaskState,
} from './LocalWorkflowTask.js'
import { loadRun, saveRun, workflowsBaseDir, type WorkflowRunRecord } from '../../tools/WorkflowTool/persistence.js'

type State = { tasks: Record<string, unknown> }

function store(initial: State) {
  let state = initial
  const setAppState = (updater: (s: any) => any) => {
    state = updater(state)
  }
  return { get: () => state, setAppState }
}

function workflowTask(): LocalWorkflowTaskState {
  return {
    // minimal TaskStateBase fields the handlers don't touch
    id: 't1',
    type: 'local_workflow',
    status: 'failed',
    summary: 'demo',
    agents: [
      { id: 's0', subtask: 'a', status: 'done' },
      { id: 's1', subtask: 'b', status: 'error' },
    ],
  } as unknown as LocalWorkflowTaskState
}

describe('skip/retry workflow agent handlers', () => {
  test('skipWorkflowAgent marks the target agent skipped, leaves others', () => {
    const s = store({ tasks: { t1: workflowTask() } })
    skipWorkflowAgent('t1', 's1', s.setAppState)
    const agents = (s.get().tasks.t1 as LocalWorkflowTaskState).agents
    expect(agents.find(a => a.id === 's1')!.status).toBe('skipped')
    expect(agents.find(a => a.id === 's0')!.status).toBe('done')
  })

  test('retryWorkflowAgent marks the target agent pending (resume re-runs it)', () => {
    const s = store({ tasks: { t1: workflowTask() } })
    retryWorkflowAgent('t1', 's1', s.setAppState)
    expect((s.get().tasks.t1 as LocalWorkflowTaskState).agents.find(a => a.id === 's1')!.status).toBe('pending')
  })

  test('no-op when the task is not a local_workflow', () => {
    const s = store({ tasks: { t1: { type: 'background', agents: [] } } })
    skipWorkflowAgent('t1', 's1', s.setAppState)
    expect((s.get().tasks.t1 as { type: string }).type).toBe('background')
  })

  test('no-op for an unknown agent id', () => {
    const s = store({ tasks: { t1: workflowTask() } })
    skipWorkflowAgent('t1', 'ghost', s.setAppState)
    const agents = (s.get().tasks.t1 as LocalWorkflowTaskState).agents
    expect(agents.map(a => a.status)).toEqual(['done', 'error'])
  })
})

describe('skip/retry persist to the on-disk run record (when the task carries runId)', () => {
  let cfg: string
  beforeAll(() => {
    cfg = mkdtempSync(join(tmpdir(), 'wf-task-'))
    process.env.CLAUDE_CONFIG_DIR = cfg
  })
  afterAll(() => {
    rmSync(cfg, { recursive: true, force: true })
    delete process.env.CLAUDE_CONFIG_DIR
  })

  function taskWithRun(): LocalWorkflowTaskState {
    return {
      id: 't9',
      type: 'local_workflow',
      status: 'failed',
      runId: 'run_t9',
      summary: 'demo',
      agents: [
        { id: 's0', subtask: 'a', status: 'done' },
        { id: 's1', subtask: 'b', status: 'error' },
      ],
    } as unknown as LocalWorkflowTaskState
  }
  const record: WorkflowRunRecord = {
    runId: 'run_t9',
    description: 'demo',
    status: 'failed',
    spec: { description: 'demo', nodes: [{ type: 'agent', id: 's0', instruction: 'a' }] },
    nodes: [
      { id: 's0', status: 'done', output: { ok: 1 } },
      { id: 's1', status: 'error', error: 'boom' },
    ],
    updatedAt: 1,
  }

  test('skip persists status:skipped to the record', () => {
    saveRun(workflowsBaseDir(), record)
    const s = store({ tasks: { t9: taskWithRun() } })
    skipWorkflowAgent('t9', 's1', s.setAppState)
    // UI updated…
    expect((s.get().tasks.t9 as LocalWorkflowTaskState).agents.find(a => a.id === 's1')!.status).toBe('skipped')
    // …and the on-disk record updated (so /workflows resume honors it).
    expect(loadRun(workflowsBaseDir(), 'run_t9')!.nodes.find(n => n.id === 's1')!.status).toBe('skipped')
  })

  test('retry persists status:pending to the record', () => {
    saveRun(workflowsBaseDir(), record)
    const s = store({ tasks: { t9: taskWithRun() } })
    retryWorkflowAgent('t9', 's1', s.setAppState)
    expect(loadRun(workflowsBaseDir(), 'run_t9')!.nodes.find(n => n.id === 's1')!.status).toBe('pending')
  })
})
