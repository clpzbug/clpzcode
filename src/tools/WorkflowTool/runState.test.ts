// src/tools/WorkflowTool/runState.test.ts
import { describe, expect, test } from 'bun:test'
import { initRunState, applyEvent, reduceEvents, progressLine } from './runState.js'
import type { WorkflowEvent } from './engine.js'

describe('runState reducer', () => {
  test('initRunState seeds pending nodes', () => {
    const s = initRunState(['a', 'b'])
    expect(s.status).toBe('running')
    expect(s.nodes).toEqual([
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'pending' },
    ])
  })

  test('folds a full event sequence into final state', () => {
    const events: WorkflowEvent[] = [
      { type: 'wave', index: 0, ids: ['a', 'b'] },
      { type: 'node-start', id: 'a', nodeType: 'agent' },
      { type: 'node-start', id: 'b', nodeType: 'agent' },
      { type: 'node-done', id: 'a', status: 'done' },
      { type: 'node-done', id: 'b', status: 'error' },
      { type: 'wave', index: 1, ids: ['c'] },
      { type: 'node-done', id: 'c', status: 'done' },
      { type: 'workflow-done', status: 'failed' },
    ]
    const s = reduceEvents(events, ['a', 'b', 'c'])
    expect(s.status).toBe('failed')
    expect(s.currentWave).toBe(1)
    expect(s.doneCount).toBe(2) // a, c
    expect(s.errorCount).toBe(1) // b
    expect(s.nodes.find(n => n.id === 'b')?.status).toBe('error')
  })

  test('node-start on an unseen id adds it as running', () => {
    let s = initRunState([])
    s = applyEvent(s, { type: 'node-start', id: 'x', nodeType: 'agent' })
    expect(s.nodes).toEqual([{ id: 'x', status: 'running' }])
  })

  test('progressLine summarizes wave + counts', () => {
    const s = reduceEvents(
      [
        { type: 'wave', index: 0, ids: ['a'] },
        { type: 'node-done', id: 'a', status: 'done' },
      ],
      ['a', 'b'],
    )
    expect(progressLine(s)).toBe('wave 1 · 1/2 done')
  })
})
