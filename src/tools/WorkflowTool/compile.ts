// src/tools/WorkflowTool/compile.ts
//
// Validate + schedule a WorkflowSpec (Task #11, Tranche A). Generalizes the
// legacy computeWaves (numeric-index waves) to the typed DAG's string-id graph:
//   1. collect every node id (recursively through container nodes) and reject
//      duplicates,
//   2. check every dependsOn / gate.ref points at an existing id,
//   3. detect cycles in the top-level dependsOn graph (Kahn),
//   4. emit topo-ordered waves of top-level node ids (wave 0 = no deps; same-wave
//      ids run concurrently; waves run in order) — the schedule the engine drives.
// Container nodes (parallel/pipeline/loop/gate) keep their internal structure;
// the engine expands them recursively at run time (gates are runtime-conditional,
// so they are NOT flattened here).

import { MAX_NODES, type WorkflowNode, type WorkflowSpec } from './spec.js'

export type CompileResult =
  | { ok: true; waves: string[][] }
  | { ok: false; errors: string[] }

/** Every id in the subtree rooted at `node` (the node itself + nested children). */
function collectIds(node: WorkflowNode, into: string[]): void {
  into.push(node.id)
  switch (node.type) {
    case 'parallel':
      for (const c of node.children) collectIds(c, into)
      break
    case 'pipeline':
      for (const s of node.steps) collectIds(s, into)
      break
    case 'loop':
      collectIds(node.body, into)
      break
    case 'gate':
      collectIds(node.then, into)
      if (node.otherwise) collectIds(node.otherwise, into)
      break
    // agent / coordinator have no nested nodes
  }
}

/** Topo-sort top-level node ids by their dependsOn edges (Kahn). Returns the
 *  wave grouping, or null if a cycle is present. */
function topoWaves(nodes: WorkflowNode[]): string[][] | null {
  const ids = nodes.map(n => n.id)
  const idSet = new Set(ids)
  // Indegree = number of (in-graph) deps still unsatisfied.
  const deps = new Map<string, Set<string>>()
  for (const n of nodes) {
    const d = new Set((n.dependsOn ?? []).filter(x => idSet.has(x)))
    // A gate's `ref` is an implicit scheduling dependency — it can't evaluate
    // until the referenced node has produced its output.
    if (n.type === 'gate' && idSet.has(n.ref)) d.add(n.ref)
    deps.set(n.id, d)
  }
  const waves: string[][] = []
  const done = new Set<string>()
  let remaining = ids.slice()
  while (remaining.length > 0) {
    const ready = remaining.filter(id =>
      [...deps.get(id)!].every(dep => done.has(dep)),
    )
    if (ready.length === 0) return null // cycle (no progress possible)
    waves.push(ready)
    for (const id of ready) done.add(id)
    remaining = remaining.filter(id => !done.has(id))
  }
  return waves
}

/** All gate.ref ids referenced anywhere in the tree (for ref validation). */
function collectGateRefs(node: WorkflowNode, into: string[]): void {
  if (node.type === 'gate') into.push(node.ref)
  switch (node.type) {
    case 'parallel':
      for (const c of node.children) collectGateRefs(c, into)
      break
    case 'pipeline':
      for (const s of node.steps) collectGateRefs(s, into)
      break
    case 'loop':
      collectGateRefs(node.body, into)
      break
    case 'gate':
      collectGateRefs(node.then, into)
      if (node.otherwise) collectGateRefs(node.otherwise, into)
      break
  }
}

export function compileSpec(spec: WorkflowSpec): CompileResult {
  const errors: string[] = []

  // 1. unique ids across the whole tree
  const allIds: string[] = []
  for (const n of spec.nodes) collectIds(n, allIds)
  const seen = new Set<string>()
  for (const id of allIds) {
    if (seen.has(id)) errors.push(`duplicate node id: "${id}"`)
    seen.add(id)
  }

  // Bound the WHOLE tree (nested children too), not just the top-level array.
  if (allIds.length > MAX_NODES) {
    errors.push(`workflow has ${allIds.length} nodes (max ${MAX_NODES})`)
  }

  // 2. every top-level dependsOn references a real top-level id
  const topIds = new Set(spec.nodes.map(n => n.id))
  for (const n of spec.nodes) {
    for (const dep of n.dependsOn ?? []) {
      if (!topIds.has(dep)) {
        errors.push(`node "${n.id}" depends on unknown id "${dep}"`)
      }
    }
  }

  // 3. every gate.ref references a real id (anywhere in the tree)
  const refs: string[] = []
  for (const n of spec.nodes) collectGateRefs(n, refs)
  // A gate.ref must be a TOP-LEVEL id: it becomes an implicit scheduling dep
  // (topoWaves), so a ref to a nested node wouldn't be ordered before the gate
  // and evalGate would always see it undefined.
  for (const ref of refs) {
    if (!topIds.has(ref)) {
      // Distinguish the two failure modes: a ref to an id that exists but is
      // nested vs. one that doesn't exist at all (`seen` holds every tree id).
      errors.push(
        seen.has(ref)
          ? `gate references nested id "${ref}" (must reference a top-level node for scheduling)`
          : `gate references unknown id "${ref}"`,
      )
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  // 4. cycle-free topo schedule of the top-level graph
  const waves = topoWaves(spec.nodes)
  if (!waves) return { ok: false, errors: ['dependency cycle among top-level nodes'] }

  return { ok: true, waves }
}
