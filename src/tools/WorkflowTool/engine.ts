// src/tools/WorkflowTool/engine.ts
//
// The workflow execution engine (Task #11, Tranche A). Drives a compiled
// WorkflowSpec: topo-ordered waves of top-level nodes, each node dispatched by
// type. Leaf work (agent/coordinator) is delegated to an INJECTED `runNode`
// (dependency injection) so the scheduling logic is unit-testable with a mock and
// the real runAgent/SyntheticOutputTool wiring stays a thin adapter at the
// integration boundary. Container nodes expand recursively at run time; gates are
// runtime-conditional. Bounded concurrency + per-node failure handling + a USD
// budget guard keep fan-out safe (ties to the MEMORY.md OOM concern).

import { availableParallelism } from 'node:os'
import { compileSpec } from './compile.js'
import { buildAttemptPlan, classifyModelError } from './resilience.js'
import type {
  AgentNode,
  CoordinatorNode,
  GateNode,
  WorkflowNode,
  WorkflowSpec,
} from './spec.js'
import { MAX_CONCURRENCY } from './spec.js'

// Core-aware default for the live-agent gate when the spec doesn't pin one: each
// concurrent agent carries its own history (the documented OOM root cause), so a
// small box shouldn't run the full 16 by default. Capped at MAX_CONCURRENCY.
function defaultLeafConcurrency(): number {
  try {
    return Math.min(MAX_CONCURRENCY, Math.max(2, availableParallelism() * 2))
  } catch {
    return MAX_CONCURRENCY
  }
}

export type NodeStatus = 'done' | 'error' | 'skipped'

export type NodeResult = {
  id: string
  status: NodeStatus
  /** Structured output (when the node had a schema) or undefined. */
  output?: unknown
  /** Free-text result (the agent's final message). */
  text?: string
  error?: string
}

/** What the engine asks the host to do for a leaf node. Injected → testable.
 *  `modelOverride` lets the engine retry a failed node on a fallback model. */
export type RunNode = (
  node: AgentNode | CoordinatorNode,
  ctx: NodeRunContext,
  modelOverride?: string,
) => Promise<{ output?: unknown; text?: string }>

export type NodeRunContext = {
  /** All node results so far, by id (pipeline handoff, coordinator integration). */
  results: ReadonlyMap<string, NodeResult>
  /** Results of this node's direct dependsOn (convenience). */
  upstream: NodeResult[]
  signal?: AbortSignal
}

export type WorkflowEvent =
  | { type: 'wave'; index: number; ids: string[] }
  | { type: 'node-start'; id: string; nodeType: WorkflowNode['type'] }
  | { type: 'node-done'; id: string; status: NodeStatus }
  | { type: 'workflow-done'; status: RunStatus }

export type RunStatus = 'completed' | 'failed' | 'aborted'

export type EngineDeps = {
  runNode: RunNode
  onEvent?: (e: WorkflowEvent) => void
  /** Total USD spent so far; checked against spec.maxCostUsd before each node. */
  costUsd?: () => number
  signal?: AbortSignal
  /** Ordered model-fallback chain for a node whose primary model keeps failing.
   *  When omitted, nodes fall back only to their configured same-model retries. */
  fallbackModels?: (primaryModel: string | undefined) => string[]
  /** Narration for resilience decisions (fallbacks, give-ups). No silent caps. */
  onLog?: (message: string) => void
  /**
   * Resume seed: results of nodes completed in a prior run (persistence.ts
   * completedOutputs()). Pre-loaded into the results map so already-done top-level
   * nodes are NOT re-run — their outputs serve as upstream context for the rest.
   */
  seed?: ReadonlyMap<string, NodeResult>
}

export type WorkflowRunResult = {
  status: RunStatus
  results: NodeResult[]
}

// Run `items` through `fn` with at most `cap` in flight. Order-independent;
// resolves when all settle (a thrown fn rejects the whole call — callers guard).
async function boundedAll<T>(
  items: T[],
  cap: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(cap, MAX_CONCURRENCY))
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      await fn(items[i]!)
    }
  })
  await Promise.all(workers)
}

// A tiny FIFO counting semaphore. Unlike boundedAll (which caps a SINGLE call),
// this is one engine-wide gate: nested parallel/loop containers can't multiply
// their per-call caps into unbounded live fan-out. Race-free — `active` only
// changes on the fast-path acquire and on a release with no waiter; a released
// slot is handed directly to the next waiter (count unchanged).
function createSemaphore(max: number): { acquire: () => Promise<void>; release: () => void } {
  const limit = Math.max(1, max)
  let active = 0
  const waiters: Array<() => void> = []
  return {
    acquire(): Promise<void> {
      if (active < limit) {
        active++
        return Promise.resolve()
      }
      return new Promise<void>(resolve => waiters.push(resolve))
    },
    release(): void {
      const next = waiters.shift()
      if (next) next()
      else active--
    },
  }
}

// Resolve a gate predicate against the referenced node's output.
function evalGate(gate: GateNode, results: ReadonlyMap<string, NodeResult>): boolean {
  const ref = results.get(gate.ref)
  if (!ref || ref.status !== 'done') return false
  let value: unknown = ref.output ?? ref.text
  if (gate.when.jsonPath) {
    for (const key of gate.when.jsonPath.split('.').filter(Boolean)) {
      value = value == null ? undefined : (value as Record<string, unknown>)[key]
    }
  }
  if (gate.when.equals !== undefined) return value === gate.when.equals
  if (gate.when.truthy !== undefined) return Boolean(value) === gate.when.truthy
  return Boolean(value)
}

export async function runWorkflow(
  spec: WorkflowSpec,
  deps: EngineDeps,
): Promise<WorkflowRunResult> {
  const compiled = compileSpec(spec)
  if (!compiled.ok) {
    throw new Error(`invalid workflow spec: ${compiled.errors.join('; ')}`)
  }

  const results = new Map<string, NodeResult>()
  // Resume: pre-load prior-run results so completed top-level nodes are skipped.
  if (deps.seed) for (const [id, r] of deps.seed) results.set(id, r)
  const byId = new Map(spec.nodes.map(n => [n.id, n] as const))
  const cap = spec.maxConcurrency ?? 4
  // Engine-wide ceiling on concurrent LIVE agents (leaf runNode calls). boundedAll
  // only caps per-call, so nested parallel/loop containers otherwise multiply into
  // unbounded fan-out (the documented OOM root cause); this single gate bounds the
  // total live agents regardless of nesting depth.
  const leafSem = createSemaphore(spec.maxConcurrency ?? defaultLeafConcurrency())
  const failFast = spec.onError === 'fail-fast'
  let aborted = false
  let failed = false

  // Guarded so a throwing host onEvent handler can never reject the wave driver
  // and tear down the run (armor for every emit site: wave/node-start/-done).
  const emit = (e: WorkflowEvent) => {
    try {
      deps.onEvent?.(e)
    } catch (err) {
      deps.onLog?.(`onEvent threw on "${e.type}" — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const overBudget = (): boolean =>
    spec.maxCostUsd !== undefined &&
    deps.costUsd !== undefined &&
    deps.costUsd() >= spec.maxCostUsd

  // Aggregate a container's status from its already-run children.
  function aggregate(childIds: string[]): NodeStatus {
    const rs = childIds.map(id => results.get(id)).filter((r): r is NodeResult => !!r)
    if (rs.length === 0) return 'skipped'
    if (rs.some(r => r.status === 'error')) return 'error'
    return rs.every(r => r.status === 'done') ? 'done' : 'skipped'
  }
  // Container nodes need their OWN result + node-done, or dependents see them as
  // missing (run too early / no handoff) and the view shows them stuck running.
  function setContainer(id: string, status: NodeStatus): void {
    results.set(id, { id, status })
    emit({ type: 'node-done', id, status })
  }

  // Recursively execute a node subtree, recording leaf results into `results`.
  async function runTree(node: WorkflowNode, upstream: NodeResult[]): Promise<void> {
    if (aborted || deps.signal?.aborted) return
    // Resume: a node SETTLED in the seeded prior run is not re-run. Keyed off deps.seed
    // (not results) so it applies at ANY depth (incl. nested in containers) WITHOUT
    // clobbering a loop body's legitimate same-id re-execution (a loop body becomes
    // 'done' in results each iteration but is never in the seed). Both 'done' (reuse
    // output) and 'skipped' (user skipped it via the panel) are terminal → not re-run.
    const seeded = deps.seed?.get(node.id)
    if (seeded && (seeded.status === 'done' || seeded.status === 'skipped')) {
      emit({ type: 'node-done', id: node.id, status: seeded.status })
      return
    }
    if (overBudget()) {
      results.set(node.id, { id: node.id, status: 'skipped', error: 'budget exceeded' })
      // Emit node-done so the live UI advances this node off pending/running —
      // otherwise a budget-skipped node stays stuck "pending" forever.
      emit({ type: 'node-done', id: node.id, status: 'skipped' })
      return
    }
    emit({ type: 'node-start', id: node.id, nodeType: node.type })

    switch (node.type) {
      case 'agent':
      case 'coordinator': {
        const ctx: NodeRunContext = { results, upstream, signal: deps.signal }
        const primaryModel = node.type === 'agent' ? node.model : undefined
        const sameModelRetries = node.type === 'agent' ? (node.retries ?? 0) : 0
        const fallbacks = node.type === 'agent' ? (deps.fallbackModels?.(primaryModel) ?? []) : []
        // primary, [retry × N], fallback#1, … — a bounded, ordered attempt list.
        const plan = buildAttemptPlan(primaryModel, sameModelRetries, fallbacks)
        let lastErr: unknown
        let idx = 0
        while (idx < plan.length) {
          // Re-check budget between attempts: the fallback loop turns one node
          // into a multi-agent unit, so without this a single flailing node could
          // spend its whole chain past spec.maxCostUsd before the next node's guard.
          if (aborted || deps.signal?.aborted || overBudget()) break
          const attempt = plan[idx]!
          // Hold a global slot ONLY around the live run (not container
          // orchestration), so total concurrent agents never exceed the gate
          // no matter how deeply parallel/loop nodes nest.
          await leafSem.acquire()
          try {
            const r = await deps.runNode(node, ctx, attempt.model)
            results.set(node.id, { id: node.id, status: 'done', output: r.output, text: r.text })
            emit({ type: 'node-done', id: node.id, status: 'done' })
            return
          } catch (err) {
            lastErr = err
          } finally {
            leafSem.release()
          }
          // A cancel raised DURING the await surfaces as an AbortError here. Break
          // before classifying so abort is never misread as a transient error and
          // retried/fallen-back — cancel must stop the node immediately.
          if (deps.signal?.aborted || aborted) break
          const kind = classifyModelError(lastErr)
          // Auth/invalid-request won't be fixed by another attempt — stop early
          // so a doomed node doesn't burn the rest of the plan (and the budget).
          if (kind === 'fatal') break
          if (kind === 'context') {
            // The same model will just overflow again — skip its remaining
            // same-model retries and jump to the first different-model attempt.
            idx++
            while (idx < plan.length && plan[idx]!.model === attempt.model) idx++
          } else {
            idx++
          }
          const next = plan[idx]
          if (next) {
            deps.onLog?.(
              `node "${node.id}": ${kind} error on ${attempt.model ?? 'default model'} — ${next.reason === 'fallback' ? `falling back to ${next.model}` : 'retrying'}`,
            )
          }
        }
        results.set(node.id, {
          id: node.id,
          status: 'error',
          error: lastErr instanceof Error ? lastErr.message : String(lastErr),
        })
        failed = true
        emit({ type: 'node-done', id: node.id, status: 'error' })
        if (failFast) aborted = true
        return
      }
      case 'parallel': {
        await boundedAll(node.children, node.concurrency ?? cap, c => runTree(c, upstream))
        setContainer(node.id, aggregate(node.children.map(c => c.id)))
        return
      }
      case 'pipeline': {
        let prev = upstream
        for (const step of node.steps) {
          if (aborted || deps.signal?.aborted) break
          await runTree(step, prev)
          const r = results.get(step.id)
          prev = r ? [r] : []
        }
        setContainer(node.id, aggregate(node.steps.map(s => s.id)))
        return
      }
      case 'loop': {
        // Each iteration overwrites node.body.id (so body.id holds the FINAL
        // iteration for downstream handoff). Track every iteration's status so an
        // error in an early iteration is not masked by a later success — aggregate
        // over all iterations, not just the last.
        const iterStatuses: NodeStatus[] = []
        for (let i = 0; i < node.count; i++) {
          if (aborted || deps.signal?.aborted) break
          await runTree(node.body, upstream)
          const r = results.get(node.body.id)
          iterStatuses.push(r ? r.status : 'skipped')
        }
        const status: NodeStatus =
          iterStatuses.length === 0
            ? 'skipped'
            : iterStatuses.some(s => s === 'error')
              ? 'error'
              : iterStatuses.every(s => s === 'done')
                ? 'done'
                : 'skipped'
        setContainer(node.id, status)
        return
      }
      case 'gate': {
        const branch = evalGate(node, results) ? node.then : node.otherwise
        if (branch) {
          await runTree(branch, upstream)
          setContainer(node.id, aggregate([branch.id]))
        } else {
          setContainer(node.id, 'skipped')
        }
        return
      }
    }
  }

  // Drive the top-level topo waves; nodes in a wave run with bounded concurrency.
  for (let w = 0; w < compiled.waves.length; w++) {
    if (aborted || deps.signal?.aborted) break
    const ids = compiled.waves[w]!
    emit({ type: 'wave', index: w, ids })
    await boundedAll(ids, cap, async id => {
      const node = byId.get(id)!
      // (Seeded top-level nodes are skipped by runTree's seed guard below.)
      const deps_ = (node.dependsOn ?? [])
        .map(d => results.get(d))
        .filter((r): r is NodeResult => r !== undefined)
      // A top-level node whose dep errored/skipped is itself skipped (continue mode).
      if (deps_.some(d => d.status !== 'done')) {
        results.set(id, { id, status: 'skipped', error: 'upstream failed' })
        emit({ type: 'node-done', id, status: 'skipped' })
        return
      }
      // Armor: a leaf already converts its own throws into an 'error' result, but
      // an unexpected throw deeper in container orchestration must never reject
      // boundedAll and tear down the whole run. Contain it as a node error and
      // keep the rest of the wave going.
      try {
        await runTree(node, deps_)
      } catch (err) {
        if (!results.has(id)) {
          results.set(id, { id, status: 'error', error: err instanceof Error ? err.message : String(err) })
          emit({ type: 'node-done', id, status: 'error' })
        }
        failed = true
        if (failFast) aborted = true
        deps.onLog?.(`node "${id}": unexpected error contained — ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  const status: RunStatus = deps.signal?.aborted || aborted ? (failed ? 'failed' : 'aborted') : failed ? 'failed' : 'completed'
  emit({ type: 'workflow-done', status })
  return { status, results: [...results.values()] }
}
