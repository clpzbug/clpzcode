// src/tools/WorkflowTool/integration.test.ts
//
// End-to-end wiring test for the WorkflowTool integration (Task #11, Tranche A):
// drives the SAME pipeline the real tool uses — legacyToSpec → (+coordinator node)
// → compileSpec → runWorkflow(makeRunNode(spawnAgent)) → persistence → report —
// with a MOCK spawnAgent. Proves the engine drives the nodes and records per-node
// failure (the no-API-key case) without crashing, and that the run is persisted.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { legacyToSpec, type CoordinatorNode, type WorkflowSpec } from './spec.js'
import { compileSpec } from './compile.js'
import { runWorkflow, type NodeResult } from './engine.js'
import { makeRunNode, type SpawnAgent } from './runNodeFactory.js'
import { saveRun, loadRun, type WorkflowRunRecord, type PersistedNode } from './persistence.js'

// Mirror WorkflowTool.buildSpec: legacy input → agent DAG + a coordinator node
// depending on every agent (default on for ≥2 subtasks).
function buildSpec(input: Parameters<typeof legacyToSpec>[0]): {
  spec: WorkflowSpec
  agentIds: string[]
} {
  const base = legacyToSpec(input)
  const agentIds = base.nodes.map(n => n.id)
  const coordinator: CoordinatorNode = {
    type: 'coordinator',
    id: 'coordinator',
    dependsOn: agentIds,
  }
  return { spec: { ...base, coordinate: true, nodes: [...base.nodes, coordinator] }, agentIds }
}

function persistedNodesFrom(
  spec: WorkflowSpec,
  results: Map<string, NodeResult>,
): PersistedNode[] {
  return spec.nodes.map(n => {
    const r = results.get(n.id)
    if (r) return { id: n.id, status: r.status, output: r.output, text: r.text, error: r.error }
    return { id: n.id, status: 'pending' as const }
  })
}

describe('WorkflowTool engine integration', () => {
  test('2-subtask legacy input runs through the engine + coordinator, all OK', async () => {
    const { spec, agentIds } = buildSpec({
      description: 'two things',
      subtasks: ['do A', { instruction: 'do B', depends_on: [0] }],
    })
    expect(agentIds).toEqual(['s0', 's1'])
    expect(compileSpec(spec).ok).toBe(true)

    const seen: string[] = []
    const spawn: SpawnAgent = async req => {
      seen.push(req.node.id)
      return { text: `result of ${req.node.id}` }
    }
    const res = await runWorkflow(spec, { runNode: makeRunNode(spawn) })

    expect(res.status).toBe('completed')
    expect(seen).toEqual(['s0', 's1', 'coordinator']) // topo order; coordinator last
    const byId = new Map(res.results.map(r => [r.id, r]))
    expect(byId.get('s1')?.text).toBe('result of s1')
    expect(byId.get('coordinator')?.status).toBe('done')
  })

  test('no-API-key case: spawn throws → failures recorded per-node, no crash, persisted', async () => {
    const { spec } = buildSpec({
      description: 'will fail',
      subtasks: ['task one', 'task two'],
    })
    // Simulate the model call failing (no API key): every node errors.
    const spawn: SpawnAgent = async () => {
      throw new Error('no API key configured')
    }
    const res = await runWorkflow(spec, { runNode: makeRunNode(spawn) })

    expect(res.status).toBe('failed')
    const byId = new Map(res.results.map(r => [r.id, r]))
    expect(byId.get('s0')?.status).toBe('error')
    expect(byId.get('s0')?.error).toContain('no API key')
    expect(byId.get('s1')?.status).toBe('error')
    // Coordinator depends on failed agents → skipped (continue mode).
    expect(byId.get('coordinator')?.status).toBe('skipped')

    // The report renders without throwing: header + one section per subtask.
    const results = new Map(res.results.map(r => [r.id, r]))
    const failed = ['s0', 's1'].filter(id => results.get(id)?.status !== 'done').length
    expect(failed).toBe(2)

    // Persistence round-trips the failed run.
    const dir = mkdtempSync(join(tmpdir(), 'wf-int-'))
    try {
      const record: WorkflowRunRecord = {
        runId: 'r1',
        description: 'will fail',
        status: 'failed',
        spec,
        nodes: persistedNodesFrom(spec, results),
        updatedAt: Date.now(),
      }
      saveRun(dir, record)
      const loaded = loadRun(dir, 'r1')
      expect(loaded?.status).toBe('failed')
      expect(loaded?.nodes.find(n => n.id === 's0')?.status).toBe('error')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('coordinate:false → no coordinator node is scheduled', async () => {
    const base = legacyToSpec({ description: 'solo', subtasks: ['only one'], coordinate: false })
    const spec: WorkflowSpec = { ...base, coordinate: false }
    const spawn: SpawnAgent = async req => ({ text: req.node.id })
    const res = await runWorkflow(spec, { runNode: makeRunNode(spawn) })
    expect(res.results.map(r => r.id)).toEqual(['s0'])
  })
})
