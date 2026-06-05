// src/tools/WorkflowTool/persistence.ts
//
// Durable run records for the workflow engine (Task #11, Tranche A). A run is
// persisted as <baseDir>/<runId>/run.json (the compiled spec + per-node status/
// output), written on each transition. resume() loads it so a re-run treats
// already-`done` nodes as satisfied (re-injecting their outputs) and re-schedules
// only pending/error nodes. Pure fs/JSON — no engine or renderer coupling, so it
// is unit-testable in isolation against a temp dir.

import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import type { NodeStatus, NodeResult } from './engine.js'
import type { WorkflowSpec } from './spec.js'

/** Default on-disk root for workflow run records: ~/.clpzcode/workflows. The
 *  unit tests pass an explicit temp dir, so this is only used at integration. */
export function workflowsBaseDir(): string {
  return join(getClaudeConfigHomeDir(), 'workflows')
}

export type PersistedNode = {
  id: string
  status: NodeStatus | 'pending'
  output?: unknown
  text?: string
  error?: string
}

export type WorkflowRunRecord = {
  runId: string
  description: string
  status: 'running' | 'completed' | 'failed' | 'aborted'
  spec: WorkflowSpec
  nodes: PersistedNode[]
  /** Epoch ms, stamped by the caller (engine has no clock access). */
  updatedAt: number
}

function runDir(baseDir: string, runId: string): string {
  return join(baseDir, runId)
}

function runFile(baseDir: string, runId: string): string {
  return join(runDir(baseDir, runId), 'run.json')
}

/** Write (atomically enough for a single writer) the run record to disk. */
export function saveRun(baseDir: string, record: WorkflowRunRecord): void {
  const dir = runDir(baseDir, record.runId)
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, 'run.json.tmp')
  writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8')
  // Atomic publish: RENAME (not copy) so a concurrent reader never sees a
  // half-written run.json. tmp + target live in the same dir = same filesystem,
  // where rename is atomic. (The prior code copied via writeFileSync, which is
  // not atomic and could expose truncated JSON — making the run "vanish".)
  renameSync(tmp, runFile(baseDir, record.runId))
}

/** Load a run record, or null if absent/unparseable. */
export function loadRun(baseDir: string, runId: string): WorkflowRunRecord | null {
  const file = runFile(baseDir, runId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as WorkflowRunRecord
  } catch {
    return null
  }
}

/** The set of node ids already `done` in a prior run — the engine can skip these
 *  on resume and re-inject their stored outputs as upstream context. */
export function completedNodeIds(record: WorkflowRunRecord): Set<string> {
  return new Set(record.nodes.filter(n => n.status === 'done').map(n => n.id))
}

/** Completed nodes as engine NodeResults, keyed by id — the exact shape EngineDeps.seed
 *  expects, so a resume caller can pass this straight to runWorkflow. */
export function completedOutputs(record: WorkflowRunRecord): Map<string, NodeResult> {
  const m = new Map<string, NodeResult>()
  for (const n of record.nodes) {
    if (n.status === 'done') {
      m.set(n.id, { id: n.id, status: 'done', output: n.output, text: n.text })
    }
  }
  return m
}
