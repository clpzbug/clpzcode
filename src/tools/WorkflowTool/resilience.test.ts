import { describe, expect, test } from 'bun:test'
import { runWorkflow, type RunNode } from './engine.js'
import { buildAttemptPlan, classifyModelError, resolveFallbackChain } from './resilience.js'
import type { WorkflowSpec } from './spec.js'

describe('classifyModelError', () => {
  test('context-window exhaustion', () => {
    expect(classifyModelError(new Error('prompt is too long: 250000 tokens > 200000 maximum'))).toBe('context')
    expect(classifyModelError(new Error('context_length_exceeded'))).toBe('context')
    expect(classifyModelError(new Error('exceeded the context limit and automatic compaction has failed'))).toBe('context')
  })
  test('fatal (auth / unknown model)', () => {
    expect(classifyModelError(new Error('401 invalid api key'))).toBe('fatal')
    expect(classifyModelError(new Error('model grok-9 does not exist'))).toBe('fatal')
  })
  test('transient, and unknown defaults to transient', () => {
    expect(classifyModelError(new Error('429 rate limit exceeded'))).toBe('transient')
    expect(classifyModelError(new Error('socket hang up'))).toBe('transient')
    expect(classifyModelError(new Error('something nobody anticipated'))).toBe('transient')
  })
})

describe('resolveFallbackChain', () => {
  test('excludes primary, de-dupes, appends parent, caps at 3', () => {
    expect(resolveFallbackChain('grok-4.3', ['grok-4.3', 'opus', 'opus', 'sonnet'], 'haiku')).toEqual(['opus', 'sonnet', 'haiku'])
  })
  test('parent model is the implicit fallback when nothing is configured', () => {
    expect(resolveFallbackChain('grok-4.3', undefined, 'sonnet')).toEqual(['sonnet'])
  })
  test('empty when the only candidate equals the primary', () => {
    expect(resolveFallbackChain('sonnet', undefined, 'sonnet')).toEqual([])
  })
  test('drops unroutable fallbacks (e.g. Anthropic targets under a Grok-pinned env)', () => {
    const routable = (m: string) => m.startsWith('grok')
    expect(resolveFallbackChain('grok-4.3', ['opus', 'grok-3', 'sonnet'], 'haiku', 3, routable)).toEqual(['grok-3'])
  })
})

describe('buildAttemptPlan', () => {
  test('primary, same-model retries, then fallbacks', () => {
    expect(buildAttemptPlan('grok', 1, ['opus', 'sonnet']).map(a => `${a.reason}:${a.model}`)).toEqual([
      'primary:grok',
      'retry:grok',
      'fallback:opus',
      'fallback:sonnet',
    ])
  })
})

const modelOf = (node: { type: string; model?: string }, override?: string) =>
  override ?? (node.type === 'agent' ? node.model : undefined)

describe('engine model fallback (flow is never interrupted)', () => {
  test('a node that overflows on its primary model recovers on a fallback model', async () => {
    const tried: Array<string | undefined> = []
    const runNode: RunNode = async (node, _ctx, override) => {
      const model = modelOf(node, override)
      tried.push(model)
      if (model === 'grok') throw new Error('prompt is too long: exceeded the context limit')
      return { text: `${node.id}@${model}` }
    }
    const spec: WorkflowSpec = { description: 'fb', nodes: [{ type: 'agent', id: 'a', instruction: 'a', model: 'grok' }] }
    const res = await runWorkflow(spec, { runNode, fallbackModels: () => ['sonnet'] })
    expect(res.status).toBe('completed')
    expect(res.results[0]!.status).toBe('done')
    expect(tried).toEqual(['grok', 'sonnet'])
  })

  test('a context overflow skips same-model retries and jumps to the fallback', async () => {
    const tried: Array<string | undefined> = []
    const runNode: RunNode = async (node, _ctx, override) => {
      const model = modelOf(node, override)
      tried.push(model)
      if (model === 'grok') throw new Error('context_length_exceeded')
      return { text: 'ok' }
    }
    const spec: WorkflowSpec = { description: 'skip', nodes: [{ type: 'agent', id: 'a', instruction: 'a', model: 'grok', retries: 3 }] }
    const res = await runWorkflow(spec, { runNode, fallbackModels: () => ['sonnet'] })
    expect(res.status).toBe('completed')
    expect(tried).toEqual(['grok', 'sonnet'])
  })

  test('a transient error retries the same model, then falls back', async () => {
    const tried: Array<string | undefined> = []
    const runNode: RunNode = async (node, _ctx, override) => {
      const model = modelOf(node, override)
      tried.push(model)
      if (model === 'grok') throw new Error('429 rate limit')
      return { text: 'ok' }
    }
    const spec: WorkflowSpec = { description: 'tr', nodes: [{ type: 'agent', id: 'a', instruction: 'a', model: 'grok', retries: 1 }] }
    const res = await runWorkflow(spec, { runNode, fallbackModels: () => ['sonnet'] })
    expect(res.status).toBe('completed')
    expect(tried).toEqual(['grok', 'grok', 'sonnet'])
  })

  test('a fatal error stops early — no retries, no fallback burned', async () => {
    const tried: Array<string | undefined> = []
    const runNode: RunNode = async (node, _ctx, override) => {
      tried.push(modelOf(node, override))
      throw new Error('401 invalid api key')
    }
    const spec: WorkflowSpec = { description: 'ft', nodes: [{ type: 'agent', id: 'a', instruction: 'a', model: 'grok', retries: 2 }] }
    const res = await runWorkflow(spec, { runNode, fallbackModels: () => ['sonnet', 'opus'] })
    expect(res.results[0]!.status).toBe('error')
    expect(tried).toEqual(['grok'])
  })

  test('a node that exhausts all attempts errors but the rest of the wave still completes', async () => {
    const runNode: RunNode = async node => {
      if (node.id === 'boom') throw new Error('kaboom')
      return { text: node.id }
    }
    const spec: WorkflowSpec = {
      description: 'armor',
      nodes: [
        { type: 'agent', id: 'boom', instruction: 'x' },
        { type: 'agent', id: 'ok', instruction: 'y' },
      ],
    }
    const res = await runWorkflow(spec, { runNode })
    expect(res.results.find(r => r.id === 'boom')!.status).toBe('error')
    expect(res.results.find(r => r.id === 'ok')!.status).toBe('done')
    expect(res.status).toBe('failed') // partial failure, but the run was not torn down
  })
})
