// src/tools/WorkflowTool/compile.test.ts
import { describe, expect, test } from 'bun:test'
import { compileSpec } from './compile.js'
import { legacyToSpec, type WorkflowSpec } from './spec.js'

const agent = (id: string, dependsOn?: string[]) => ({
  type: 'agent' as const,
  id,
  instruction: id,
  dependsOn,
})

describe('compileSpec', () => {
  test('legacy parallel subtasks → single wave', () => {
    const r = compileSpec(legacyToSpec({ description: 'd', subtasks: ['a', 'b', 'c'] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.waves).toEqual([['s0', 's1', 's2']])
  })

  test('depends_on chain → sequential waves', () => {
    const spec = legacyToSpec({
      description: 'd',
      subtasks: ['a', { instruction: 'b', depends_on: [0] }, { instruction: 'c', depends_on: [1] }],
    })
    const r = compileSpec(spec)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.waves).toEqual([['s0'], ['s1'], ['s2']])
  })

  test('diamond deps → correct wave grouping', () => {
    const spec: WorkflowSpec = {
      description: 'diamond',
      nodes: [agent('a'), agent('b', ['a']), agent('c', ['a']), agent('d', ['b', 'c'])],
    }
    const r = compileSpec(spec)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.waves[0]).toEqual(['a'])
      expect(new Set(r.waves[1])).toEqual(new Set(['b', 'c']))
      expect(r.waves[2]).toEqual(['d'])
    }
  })

  test('detects a dependency cycle', () => {
    const spec: WorkflowSpec = {
      description: 'cycle',
      nodes: [agent('a', ['b']), agent('b', ['a'])],
    }
    const r = compileSpec(spec)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => e.includes('cycle'))).toBe(true)
  })

  test('rejects dependsOn on an unknown id', () => {
    const r = compileSpec({ description: 'd', nodes: [agent('a', ['ghost'])] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => e.includes('ghost'))).toBe(true)
  })

  test('rejects duplicate ids (incl. nested)', () => {
    const spec: WorkflowSpec = {
      description: 'dup',
      nodes: [
        agent('x'),
        { type: 'pipeline', id: 'p', steps: [agent('x'), agent('y')] },
      ],
    }
    const r = compileSpec(spec)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => e.includes('duplicate'))).toBe(true)
  })

  test('rejects a gate referencing an unknown id', () => {
    const spec: WorkflowSpec = {
      description: 'g',
      nodes: [
        agent('a'),
        { type: 'gate', id: 'g', ref: 'nope', when: { truthy: true }, then: agent('t') },
      ],
    }
    const r = compileSpec(spec)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => e.includes('unknown id "nope"'))).toBe(true)
  })

  test('rejects a gate referencing a NESTED (non-top-level) id', () => {
    const spec: WorkflowSpec = {
      description: 'nested-ref',
      nodes: [
        { type: 'pipeline', id: 'p', steps: [agent('inner')] },
        { type: 'gate', id: 'g', ref: 'inner', when: { truthy: true }, then: agent('t') },
      ],
    }
    const r = compileSpec(spec)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => e.includes('nested id "inner"'))).toBe(true)
  })
})
