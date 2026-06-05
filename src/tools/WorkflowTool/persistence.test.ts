// src/tools/WorkflowTool/persistence.test.ts
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  saveRun,
  loadRun,
  completedNodeIds,
  completedOutputs,
  type WorkflowRunRecord,
} from './persistence.js'

const base = mkdtempSync(join(tmpdir(), 'wf-persist-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

const record: WorkflowRunRecord = {
  runId: 'run_test1',
  description: 'd',
  status: 'running',
  spec: { description: 'd', nodes: [{ type: 'agent', id: 'a', instruction: 'x' }] },
  nodes: [
    { id: 'a', status: 'done', output: { ok: 1 }, text: 'hi' },
    { id: 'b', status: 'error', error: 'boom' },
    { id: 'c', status: 'pending' },
  ],
  updatedAt: 1700000000000,
}

describe('persistence', () => {
  test('save then load round-trips the record', () => {
    saveRun(base, record)
    const loaded = loadRun(base, 'run_test1')
    expect(loaded).toEqual(record)
  })

  test('loadRun returns null for an unknown run', () => {
    expect(loadRun(base, 'nope')).toBeNull()
  })

  test('completedNodeIds = only done nodes', () => {
    expect([...completedNodeIds(record)]).toEqual(['a'])
  })

  test('completedOutputs re-injects done node outputs as engine NodeResults', () => {
    const out = completedOutputs(record)
    // Shape matches EngineDeps.seed (NodeResult): includes id + status:'done'.
    expect(out.get('a')).toEqual({ id: 'a', status: 'done', output: { ok: 1 }, text: 'hi' })
    expect(out.has('b')).toBe(false)
  })
})
