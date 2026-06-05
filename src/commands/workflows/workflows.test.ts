// src/commands/workflows/workflows.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveRun, type WorkflowRunRecord } from '../../tools/WorkflowTool/persistence.js'

// The command reads workflowsBaseDir() (= ~/.clpzcode/workflows). Point CLPZCODE config
// home at a temp dir so the test is isolated and never touches the real store.
let base: string
let call: (args: string) => Promise<{ type: string; value?: string }>

const record = (over: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord => ({
  runId: 'run_cmd1',
  description: 'demo',
  status: 'failed',
  spec: { description: 'demo', nodes: [{ type: 'agent', id: 's0', instruction: 'x' }] },
  nodes: [
    { id: 's0', status: 'done', output: { ok: 1 } },
    { id: 's1', status: 'error', error: 'boom' },
  ],
  updatedAt: 1700000000000,
  ...over,
})

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
  process.env.CLAUDE_CONFIG_DIR = base
  const mod = await import('./index.js')
  call = (await mod.default.load()).call as typeof call
})
afterAll(() => {
  rmSync(base, { recursive: true, force: true })
  delete process.env.CLAUDE_CONFIG_DIR
})

describe('/workflows resume subcommand', () => {
  test('reports a resumable run with the pending/error count + tool hint', async () => {
    const { workflowsBaseDir } = await import('../../tools/WorkflowTool/persistence.js')
    saveRun(workflowsBaseDir(), record())
    const r = await call('resume run_cmd1')
    expect(r.type).toBe('text')
    expect(r.value).toContain('resumable')
    expect(r.value).toContain('WorkflowTool')
    expect(r.value).toContain('run_cmd1')
  })

  test('rejects an unknown run id', async () => {
    const r = await call('resume nope')
    expect(r.value).toContain('No workflow run')
  })

  test('rejects a fully-completed run', async () => {
    const { workflowsBaseDir } = await import('../../tools/WorkflowTool/persistence.js')
    saveRun(
      workflowsBaseDir(),
      record({ runId: 'run_done', status: 'completed', nodes: [{ id: 's0', status: 'done' }] }),
    )
    const r = await call('resume run_done')
    expect(r.value).toContain('no pending or error nodes')
  })

  test('usage when no id given', async () => {
    const r = await call('resume')
    expect(r.value).toContain('Usage: /workflows resume')
  })
})
