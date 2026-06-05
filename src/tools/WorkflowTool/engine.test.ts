// src/tools/WorkflowTool/engine.test.ts
import { describe, expect, test } from 'bun:test'
import { runWorkflow, type RunNode } from './engine.js'
import type { WorkflowSpec } from './spec.js'

const agent = (id: string, dependsOn?: string[]) => ({
  type: 'agent' as const,
  id,
  instruction: id,
  dependsOn,
})

// Mock runNode: records call order, returns text = id (or echoes upstream for pipeline).
function recorder() {
  const order: string[] = []
  const runNode: RunNode = async (node, ctx) => {
    order.push(node.id)
    return { text: node.id, output: { from: node.id, up: ctx.upstream.map(u => u.id) } }
  }
  return { order, runNode }
}

describe('runWorkflow', () => {
  test('runs agents in topological wave order, all done', async () => {
    const spec: WorkflowSpec = {
      description: 'chain',
      nodes: [agent('a'), agent('b', ['a']), agent('c', ['b'])],
    }
    const { order, runNode } = recorder()
    const res = await runWorkflow(spec, { runNode })
    expect(res.status).toBe('completed')
    expect(order).toEqual(['a', 'b', 'c'])
    expect(res.results.every(r => r.status === 'done')).toBe(true)
  })

  test('pipeline threads each step output to the next upstream', async () => {
    const spec: WorkflowSpec = {
      description: 'pipe',
      nodes: [
        { type: 'pipeline', id: 'p', steps: [agent('s1'), agent('s2'), agent('s3')] },
      ],
    }
    const seenUpstream: Record<string, string[]> = {}
    const runNode: RunNode = async (node, ctx) => {
      seenUpstream[node.id] = ctx.upstream.map(u => u.id)
      return { text: node.id }
    }
    await runWorkflow(spec, { runNode })
    expect(seenUpstream.s2).toEqual(['s1'])
    expect(seenUpstream.s3).toEqual(['s2'])
  })

  test('gate truthy → then branch; else → otherwise', async () => {
    const mk = (truthy: boolean): WorkflowSpec => ({
      description: 'gate',
      nodes: [
        agent('probe'),
        {
          type: 'gate',
          id: 'g',
          ref: 'probe',
          when: { jsonPath: 'flag', equals: truthy },
          then: agent('thenNode'),
          otherwise: agent('elseNode'),
        },
      ],
    })
    const runNode: RunNode = async node =>
      node.id === 'probe' ? { output: { flag: true } } : { text: node.id }
    const ran = (await runWorkflow(mk(true), { runNode })).results.map(r => r.id)
    expect(ran).toContain('thenNode')
    expect(ran).not.toContain('elseNode')
  })

  test('continue mode: a failed node skips its dependents, others still run', async () => {
    const spec: WorkflowSpec = {
      description: 'fail',
      nodes: [agent('a'), agent('b', ['a']), agent('c')],
    }
    const runNode: RunNode = async node => {
      if (node.id === 'a') throw new Error('boom')
      return { text: node.id }
    }
    const res = await runWorkflow(spec, { runNode })
    expect(res.status).toBe('failed')
    const byId = new Map(res.results.map(r => [r.id, r.status]))
    expect(byId.get('a')).toBe('error')
    expect(byId.get('b')).toBe('skipped') // dependent of failed a
    expect(byId.get('c')).toBe('done') // independent
  })

  test('retries: a node that fails then succeeds ends done', async () => {
    const spec: WorkflowSpec = {
      description: 'retry',
      nodes: [{ type: 'agent', id: 'flaky', instruction: 'x', retries: 2 }],
    }
    let calls = 0
    const runNode: RunNode = async () => {
      calls++
      if (calls < 3) throw new Error('transient')
      return { text: 'ok' }
    }
    const res = await runWorkflow(spec, { runNode })
    expect(res.status).toBe('completed')
    expect(calls).toBe(3)
  })

  test('budget guard skips nodes once the ceiling is hit', async () => {
    const spec: WorkflowSpec = {
      description: 'budget',
      nodes: [agent('a'), agent('b', ['a'])],
      maxCostUsd: 1,
    }
    const { runNode } = recorder()
    const events: { type: string; id?: string; status?: string }[] = []
    const res = await runWorkflow(spec, { runNode, costUsd: () => 5, onEvent: e => events.push(e) })
    expect(res.results.find(r => r.id === 'a')?.status).toBe('skipped')
    // The budget-skipped node must emit node-done so the live UI doesn't hang.
    expect(events.some(e => e.type === 'node-done' && e.id === 'a' && e.status === 'skipped')).toBe(true)
  })

  test('container node gets a done result + node-done, and dependents run', async () => {
    const spec: WorkflowSpec = {
      description: 'container-dep',
      nodes: [
        { type: 'pipeline', id: 'p', steps: [agent('a'), agent('b')] },
        agent('after', ['p']),
      ],
    }
    const events: { type: string; id?: string }[] = []
    const { runNode } = recorder()
    const res = await runWorkflow(spec, { runNode, onEvent: e => events.push(e) })
    expect(res.status).toBe('completed')
    const byId = new Map(res.results.map(r => [r.id, r.status]))
    expect(byId.get('p')).toBe('done') // container has a result
    expect(byId.get('after')).toBe('done') // dependent ran, not skipped
    expect(events.some(e => e.type === 'node-done' && e.id === 'p')).toBe(true)
  })

  test('loop runs its body `count` times and aggregates done', async () => {
    const spec: WorkflowSpec = {
      description: 'loop',
      nodes: [{ type: 'loop', id: 'l', count: 3, body: agent('body') }],
    }
    const { order, runNode } = recorder()
    const res = await runWorkflow(spec, { runNode })
    expect(order).toEqual(['body', 'body', 'body'])
    expect(res.results.find(r => r.id === 'l')?.status).toBe('done')
  })

  test('loop status is error if any iteration errors (not masked by later success)', async () => {
    const spec: WorkflowSpec = {
      description: 'loop-fail',
      nodes: [{ type: 'loop', id: 'l', count: 3, body: agent('body') }],
    }
    let calls = 0
    const runNode: RunNode = async () => {
      calls++
      if (calls === 2) throw new Error('iter-2 boom') // middle iteration fails
      return { text: 'ok' }
    }
    const res = await runWorkflow(spec, { runNode })
    expect(res.results.find(r => r.id === 'l')?.status).toBe('error')
  })

  test('parallel runs all children and respects the concurrency cap', async () => {
    const spec: WorkflowSpec = {
      description: 'par',
      nodes: [
        {
          type: 'parallel',
          id: 'par',
          concurrency: 2,
          children: [agent('w'), agent('x'), agent('y'), agent('z')],
        },
      ],
    }
    let inFlight = 0
    let maxInFlight = 0
    const ran: string[] = []
    const runNode: RunNode = async node => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(r => setTimeout(r, 5))
      ran.push(node.id)
      inFlight--
      return { text: node.id }
    }
    const res = await runWorkflow(spec, { runNode })
    expect(ran.sort()).toEqual(['w', 'x', 'y', 'z'])
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(res.results.find(r => r.id === 'par')?.status).toBe('done')
  })

  test('global leaf semaphore caps total live agents across NESTED containers', async () => {
    // Two top-level parallel containers run concurrently, each fanning out to 4
    // children (8 leaves). Per-call caps alone would allow up to 8 in flight;
    // maxConcurrency=3 is the ENGINE-WIDE gate, so never more than 3 run at once.
    const spec: WorkflowSpec = {
      description: 'nested-par',
      maxConcurrency: 3,
      nodes: [
        { type: 'parallel', id: 'p1', concurrency: 4, children: [agent('a'), agent('b'), agent('c'), agent('d')] },
        { type: 'parallel', id: 'p2', concurrency: 4, children: [agent('e'), agent('f'), agent('g'), agent('h')] },
      ],
    }
    let inFlight = 0
    let maxInFlight = 0
    const runNode: RunNode = async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return { text: 'ok' }
    }
    const res = await runWorkflow(spec, { runNode })
    expect(res.status).toBe('completed')
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  test('fail-fast aborts the run on the first node error', async () => {
    const spec: WorkflowSpec = {
      description: 'failfast',
      nodes: [agent('a'), agent('b', ['a'])],
      onError: 'fail-fast',
    }
    const runNode: RunNode = async node => {
      if (node.id === 'a') throw new Error('boom')
      return { text: node.id }
    }
    const res = await runWorkflow(spec, { runNode })
    expect(res.status).toBe('failed')
    expect(res.results.find(r => r.id === 'a')?.status).toBe('error')
  })

  test('a pre-aborted signal halts before any node runs', async () => {
    const spec: WorkflowSpec = {
      description: 'abort',
      nodes: [agent('a'), agent('b')],
    }
    const { order, runNode } = recorder()
    const controller = new AbortController()
    controller.abort()
    const res = await runWorkflow(spec, { runNode, signal: controller.signal })
    expect(order).toEqual([])
    expect(res.status).toBe('aborted')
  })

  test('resume seed skips re-running already-completed nodes', async () => {
    const spec: WorkflowSpec = {
      description: 'resume',
      nodes: [agent('a'), agent('b', ['a'])],
    }
    const { order, runNode } = recorder()
    // 'a' completed in a prior run — seed it; only 'b' should run now.
    const seed = new Map([['a', { id: 'a', status: 'done' as const, text: 'prior' }]])
    const res = await runWorkflow(spec, { runNode, seed })
    expect(order).toEqual(['b']) // 'a' not re-run
    expect(res.status).toBe('completed')
    // 'b' saw the seeded 'a' as its satisfied upstream.
    expect(res.results.find(r => r.id === 'a')?.text).toBe('prior')
  })

  test('resume seed treats a seeded SKIPPED node as settled (not re-run)', async () => {
    const spec: WorkflowSpec = {
      description: 'resume-skip',
      nodes: [agent('a'), agent('b')], // independent — 'a' skipped shouldn't block 'b'
    }
    const { order, runNode } = recorder()
    // 'a' was skipped in the prior run — seeded as skipped → must NOT re-run; 'b' runs.
    const seed = new Map([['a', { id: 'a', status: 'skipped' as const }]])
    const res = await runWorkflow(spec, { runNode, seed })
    expect(order).toEqual(['b'])
    expect(res.results.find(r => r.id === 'a')?.status).toBe('skipped')
  })

  test('resume seed skips nodes nested inside a container (not just top-level)', async () => {
    const spec: WorkflowSpec = {
      description: 'resume-nested',
      nodes: [{ type: 'pipeline', id: 'p', steps: [agent('s1'), agent('s2')] }],
    }
    const { order, runNode } = recorder()
    // s1 (nested in pipeline p) completed in a prior run — must NOT re-run.
    const seed = new Map([['s1', { id: 's1', status: 'done' as const, text: 'prior-s1' }]])
    const res = await runWorkflow(spec, { runNode, seed })
    expect(order).toEqual(['s2']) // s1 skipped at depth, only s2 runs
    expect(res.results.find(r => r.id === 's1')?.text).toBe('prior-s1')
    expect(res.results.find(r => r.id === 'p')?.status).toBe('done')
  })
})
