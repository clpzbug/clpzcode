// src/tools/WorkflowTool/workflowsStore.test.ts
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveRun, type WorkflowRunRecord } from './persistence.js'
import { listRuns, showRun, isResumable, killRun } from './workflowsStore.js'

const base = mkdtempSync(join(tmpdir(), 'wf-store-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

const rec = (runId: string, status: WorkflowRunRecord['status'], updatedAt: number): WorkflowRunRecord => ({
  runId,
  description: runId,
  status,
  spec: { description: runId, nodes: [{ type: 'agent', id: 'a', instruction: 'x' }] },
  nodes: [
    { id: 'a', status: 'done' },
    { id: 'b', status: 'error', error: 'x' },
    { id: 'c', status: 'pending' },
  ],
  updatedAt,
})

describe('workflowsStore', () => {
  test('listRuns returns summaries newest-first', () => {
    saveRun(base, rec('run_old', 'completed', 1000))
    saveRun(base, rec('run_new', 'failed', 2000))
    const runs = listRuns(base)
    expect(runs.map(r => r.runId)).toEqual(['run_new', 'run_old'])
    expect(runs[0]).toMatchObject({ total: 3, done: 1, errors: 1 })
  })

  test('listRuns is empty for a missing dir', () => {
    expect(listRuns(join(base, 'nope'))).toEqual([])
  })

  test('showRun loads the full record', () => {
    expect(showRun(base, 'run_new')?.status).toBe('failed')
    expect(showRun(base, 'ghost')).toBeNull()
  })

  test('isResumable: true when pending/error remain and not running', () => {
    expect(isResumable(rec('x', 'failed', 1))).toBe(true)
    expect(isResumable(rec('x', 'running', 1))).toBe(false)
    expect(
      isResumable({ ...rec('x', 'completed', 1), nodes: [{ id: 'a', status: 'done' }] }),
    ).toBe(false)
  })

  test('killRun marks aborted + pending→skipped, persisted', () => {
    saveRun(base, rec('run_kill', 'running', 3000))
    const killed = killRun(base, 'run_kill', 9999)
    expect(killed?.status).toBe('aborted')
    expect(killed?.nodes.find(n => n.id === 'c')?.status).toBe('skipped')
    expect(showRun(base, 'run_kill')?.status).toBe('aborted') // persisted
  })
})
