// src/tools/WorkflowTool/spec.test.ts
import { describe, expect, test } from 'bun:test'
import {
  legacyToSpec,
  workflowSpecSchema,
  workflowNodeSchema,
  MAX_LOOP_COUNT,
} from './spec.js'

describe('legacyToSpec', () => {
  test('plain-string subtasks → parallel agent nodes (no deps)', () => {
    const spec = legacyToSpec({ description: 'd', subtasks: ['a', 'b'] })
    expect(spec.nodes.map(n => n.id)).toEqual(['s0', 's1'])
    expect(spec.nodes.every(n => n.type === 'agent')).toBe(true)
    expect((spec.nodes[0] as { dependsOn?: string[] }).dependsOn).toEqual([])
    expect((spec.nodes[1] as { dependsOn?: string[] }).dependsOn).toEqual([])
  })

  test('depends_on numeric indices → s{j} id edges (backward refs only)', () => {
    const spec = legacyToSpec({
      description: 'd',
      subtasks: [
        'first',
        { instruction: 'second', depends_on: [0] },
        // forward ref (3) is dropped; backward ref (1) kept
        { instruction: 'third', depends_on: [1, 3] },
      ],
    })
    expect((spec.nodes[1] as { dependsOn?: string[] }).dependsOn).toEqual(['s0'])
    expect((spec.nodes[2] as { dependsOn?: string[] }).dependsOn).toEqual(['s1'])
  })

  test('carries the coordinate flag through', () => {
    expect(legacyToSpec({ description: 'd', subtasks: ['a'], coordinate: true }).coordinate).toBe(true)
  })

  test('threads per-subtask model/agentName onto the agent node', () => {
    const spec = legacyToSpec({
      description: 'd',
      subtasks: [
        'plain',
        { instruction: 'cheap', model: 'haiku' },
        { instruction: 'named', agentName: 'reviewer' },
      ],
    })
    expect((spec.nodes[0] as { model?: string }).model).toBeUndefined()
    expect((spec.nodes[1] as { model?: string }).model).toBe('haiku')
    expect((spec.nodes[2] as { agentName?: string }).agentName).toBe('reviewer')
  })
})

describe('workflowSpecSchema', () => {
  test('accepts a typed DAG with agent + pipeline + gate nodes', () => {
    const ok = workflowSpecSchema.safeParse({
      description: 'review then verify',
      nodes: [
        { type: 'agent', id: 'find', instruction: 'find bugs', schema: { type: 'object' } },
        {
          type: 'pipeline',
          id: 'pipe',
          dependsOn: ['find'],
          steps: [
            { type: 'agent', id: 'a1', instruction: 'step 1' },
            { type: 'agent', id: 'a2', instruction: 'step 2' },
          ],
        },
        {
          type: 'gate',
          id: 'g',
          ref: 'find',
          when: { truthy: true },
          then: { type: 'agent', id: 'fix', instruction: 'fix it' },
        },
        { type: 'coordinator', id: 'coord', dependsOn: ['pipe'] },
      ],
    })
    expect(ok.success).toBe(true)
  })

  test('rejects a loop count over the cap', () => {
    const bad = workflowNodeSchema.safeParse({
      type: 'loop',
      id: 'l',
      count: MAX_LOOP_COUNT + 1,
      body: { type: 'agent', id: 'b', instruction: 'x' },
    })
    expect(bad.success).toBe(false)
  })

  test('rejects an agent node missing instruction', () => {
    const bad = workflowNodeSchema.safeParse({ type: 'agent', id: 'x' })
    expect(bad.success).toBe(false)
  })

  test('rejects a gate with an empty `when` (no condition)', () => {
    const bad = workflowNodeSchema.safeParse({
      type: 'gate',
      id: 'g',
      ref: 'probe',
      when: {},
      then: { type: 'agent', id: 't', instruction: 'x' },
    })
    expect(bad.success).toBe(false)
  })
})
