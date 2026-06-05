// src/tools/WorkflowTool/runNodeFactory.test.ts
import { describe, expect, test } from 'bun:test'
import { makeRunNode, buildNodePrompt, type SpawnAgent } from './runNodeFactory.js'
import type { NodeRunContext } from './engine.js'

const emptyCtx: NodeRunContext = { results: new Map(), upstream: [] }

describe('buildNodePrompt', () => {
  test('agent with no upstream → just the instruction', () => {
    const p = buildNodePrompt({ type: 'agent', id: 'a', instruction: 'do the thing' }, emptyCtx)
    expect(p).toBe('do the thing')
  })

  test('appends upstream outputs + a schema hint', () => {
    const ctx: NodeRunContext = {
      results: new Map(),
      upstream: [{ id: 'prev', status: 'done', output: { n: 1 } }],
    }
    const p = buildNodePrompt(
      { type: 'agent', id: 'a', instruction: 'use it', schema: { type: 'object' } },
      ctx,
    )
    expect(p).toContain('use it')
    expect(p).toContain('Output from prerequisite step(s):')
    expect(p).toContain('### prev')
    expect(p).toContain('"n": 1')
    expect(p).toContain('structured output')
  })

  test('coordinator with no instruction uses the default integration prompt', () => {
    const p = buildNodePrompt({ type: 'coordinator', id: 'c' }, emptyCtx)
    expect(p).toContain('Integrate the results')
  })
})

describe('makeRunNode', () => {
  test('calls spawnAgent with the built prompt + schema/model, maps output', async () => {
    const calls: { prompt: string; schema?: unknown; model?: string }[] = []
    const spawn: SpawnAgent = async req => {
      calls.push({ prompt: req.prompt, schema: req.schema, model: req.model })
      return { text: 'done', structuredOutput: { ok: true } }
    }
    const runNode = makeRunNode(spawn)
    const res = await runNode(
      { type: 'agent', id: 'a', instruction: 'go', schema: { type: 'object' }, model: 'sonnet' },
      emptyCtx,
    )
    expect(res.text).toBe('done')
    expect(res.output).toEqual({ ok: true })
    expect(calls[0]!.schema).toEqual({ type: 'object' })
    expect(calls[0]!.model).toBe('sonnet')
    expect(calls[0]!.prompt).toContain('go')
  })

  test('propagates a spawnAgent rejection (engine handles retry/error)', async () => {
    const runNode = makeRunNode(async () => {
      throw new Error('provider down')
    })
    await expect(
      runNode({ type: 'agent', id: 'a', instruction: 'x' }, emptyCtx),
    ).rejects.toThrow('provider down')
  })
})
