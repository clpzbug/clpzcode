// src/tools/WorkflowTool/resume.test.ts
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveRun, type WorkflowRunRecord } from './persistence.js'
import { setRunNodeStatus } from './workflowsStore.js'
import { resolveResume } from './resume.js'

const base = mkdtempSync(join(tmpdir(), 'wf-resume-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

function record(runId: string, over: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    runId,
    description: 'demo workflow',
    status: 'failed',
    spec: {
      description: 'demo workflow',
      nodes: [
        { type: 'agent', id: 's0', instruction: 'first' },
        { type: 'agent', id: 's1', instruction: 'second', dependsOn: ['s0'] },
      ],
    },
    nodes: [
      { id: 's0', status: 'done', output: { ok: 1 }, text: 'first-out' },
      { id: 's1', status: 'error', error: 'boom' },
    ],
    updatedAt: 1700000000000,
    ...over,
  }
}

describe('resolveResume', () => {
  test('returns ok with spec + seed of completed nodes for a resumable run', () => {
    saveRun(base, record('run_ok'))
    const r = resolveResume(base, 'run_ok')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.description).toBe('demo workflow')
      expect(r.spec.nodes.map(n => n.id)).toEqual(['s0', 's1'])
      // Seed = the engine NodeResult of the completed (done) node only.
      expect([...r.seed.keys()]).toEqual(['s0'])
      expect(r.seed.get('s0')).toEqual({ id: 's0', status: 'done', output: { ok: 1 }, text: 'first-out' })
      // The error node is NOT seeded → it will re-run.
      expect(r.seed.has('s1')).toBe(false)
    }
  })

  test('rejects an unknown run', () => {
    const r = resolveResume(base, 'does-not-exist')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('No workflow run')
  })

  test('rejects a still-running run', () => {
    saveRun(base, record('run_running', { status: 'running' }))
    const r = resolveResume(base, 'run_running')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('still running')
  })

  test('rejects a fully-completed run (no pending/error nodes)', () => {
    saveRun(
      base,
      record('run_done', {
        status: 'completed',
        nodes: [
          { id: 's0', status: 'done', output: { ok: 1 } },
          { id: 's1', status: 'done', output: { ok: 2 } },
        ],
      }),
    )
    const r = resolveResume(base, 'run_done')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('no pending or error nodes')
  })

  // A record with a 3rd pending node so it stays resumable after skipping s1.
  const threeNode = (runId: string): WorkflowRunRecord =>
    record(runId, {
      spec: {
        description: 'demo workflow',
        nodes: [
          { type: 'agent', id: 's0', instruction: 'first' },
          { type: 'agent', id: 's1', instruction: 'second' },
          { type: 'agent', id: 's2', instruction: 'third' },
        ],
      },
      nodes: [
        { id: 's0', status: 'done', output: { ok: 1 }, text: 'first-out' },
        { id: 's1', status: 'error', error: 'boom' },
        { id: 's2', status: 'pending' },
      ],
    })

  test('a node skipped on disk is carried in the seed as settled (skipped, not re-run)', () => {
    saveRun(base, threeNode('run_skip'))
    // Panel skip → persist the node as 'skipped' (what skipWorkflowAgent does).
    setRunNodeStatus(base, 'run_skip', 's1', 'skipped', 1700000001000)
    const r = resolveResume(base, 'run_skip')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.seed.get('s0')?.status).toBe('done') // done → output reused
      expect(r.seed.get('s1')).toEqual({ id: 's1', status: 'skipped' }) // skipped → settled
      expect(r.seed.has('s2')).toBe(false) // pending → re-runs
    }
  })

  test('retry (persist a node pending) leaves it OUT of the seed so it re-runs', () => {
    saveRun(base, threeNode('run_retry'))
    setRunNodeStatus(base, 'run_retry', 's1', 'pending', 1700000001000)
    const r = resolveResume(base, 'run_retry')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.seed.has('s1')).toBe(false) // pending → re-runs
  })

  test('a pending (not error) node also makes the run resumable', () => {
    saveRun(
      base,
      record('run_pending', {
        status: 'aborted',
        nodes: [
          { id: 's0', status: 'done', output: { ok: 1 }, text: 'x' },
          { id: 's1', status: 'pending' },
        ],
      }),
    )
    const r = resolveResume(base, 'run_pending')
    expect(r.ok).toBe(true)
    if (r.ok) expect([...r.seed.keys()]).toEqual(['s0'])
  })
})
