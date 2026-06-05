// src/tools/WorkflowTool/runState.ts
//
// Renderer-agnostic view state for the workflow visual layer (Task #11, §4). The
// engine emits WorkflowEvents; this folds them into a WorkflowRunState that the
// UI renders — an Ink progress view now, the OpenTUI orchestration panel later.
// Pure data + reducer (no React/renderer coupling) so it works across the
// Ink→OpenTUI migration and is unit-testable in isolation.

import type { WorkflowEvent, NodeStatus, RunStatus } from './engine.js'

export type NodeViewStatus = 'pending' | 'running' | NodeStatus

export type NodeView = {
  id: string
  status: NodeViewStatus
}

export type WorkflowRunState = {
  status: 'running' | RunStatus
  currentWave: number
  nodes: NodeView[]
  doneCount: number
  errorCount: number
}

export function initRunState(nodeIds: string[] = []): WorkflowRunState {
  return {
    status: 'running',
    currentWave: -1,
    nodes: nodeIds.map(id => ({ id, status: 'pending' as const })),
    doneCount: 0,
    errorCount: 0,
  }
}

function upsert(nodes: NodeView[], id: string, status: NodeViewStatus): NodeView[] {
  const idx = nodes.findIndex(n => n.id === id)
  if (idx === -1) return [...nodes, { id, status }]
  const next = nodes.slice()
  next[idx] = { id, status }
  return next
}

/** Fold one engine event into the run state (immutable — returns a new state). */
export function applyEvent(state: WorkflowRunState, event: WorkflowEvent): WorkflowRunState {
  switch (event.type) {
    case 'wave':
      return { ...state, currentWave: event.index }
    case 'node-start':
      return { ...state, nodes: upsert(state.nodes, event.id, 'running') }
    case 'node-done': {
      const nodes = upsert(state.nodes, event.id, event.status)
      return {
        ...state,
        nodes,
        doneCount: nodes.filter(n => n.status === 'done').length,
        errorCount: nodes.filter(n => n.status === 'error').length,
      }
    }
    case 'workflow-done':
      return { ...state, status: event.status }
    default:
      // Unknown/future event type: keep the reducer total (return state unchanged)
      // rather than returning undefined and breaking immutable consumers.
      return state
  }
}

/** Convenience: fold a whole event sequence (e.g. for resume/replay). */
export function reduceEvents(
  events: WorkflowEvent[],
  nodeIds: string[] = [],
): WorkflowRunState {
  return events.reduce(applyEvent, initRunState(nodeIds))
}

/** A compact one-line progress summary for the spinner/footer. */
export function progressLine(state: WorkflowRunState): string {
  const total = state.nodes.length
  const parts = [`wave ${Math.max(0, state.currentWave + 1)}`, `${state.doneCount}/${total} done`]
  if (state.errorCount > 0) parts.push(`${state.errorCount} error`)
  return parts.join(' · ')
}
