// src/tools/WorkflowTool/resume.ts
//
// Resume driver (#30): resolve a prior run id into the {spec, seed} the engine needs to
// re-run ONLY its pending/error nodes. The engine already pre-loads deps.seed and skips
// seeded-done nodes at any depth (engine.ts) — this is the thin tool-side adapter that
// loads the persisted record, guards it, and produces the seed from completedOutputs().
// Pure (fs reads only via persistence) and self-contained → fully unit-testable.

import type { NodeResult } from './engine.js'
import { completedOutputs, loadRun, type WorkflowRunRecord } from './persistence.js'
import { isResumable } from './workflowsStore.js'
import type { WorkflowSpec } from './spec.js'

export type ResumeResolution =
  | {
      ok: true
      record: WorkflowRunRecord
      spec: WorkflowSpec
      description: string
      /** Completed nodes from the prior run — engine seed (skips them on re-run). */
      seed: Map<string, NodeResult>
    }
  | { ok: false; message: string }

/** Load a prior run and validate it can be resumed; build the engine seed. */
export function resolveResume(baseDir: string, runId: string): ResumeResolution {
  const record = loadRun(baseDir, runId)
  if (!record) return { ok: false, message: `No workflow run "${runId}" found.` }
  if (record.status === 'running') {
    return { ok: false, message: `Workflow "${runId}" is still running — cannot resume.` }
  }
  if (!isResumable(record)) {
    return { ok: false, message: `Workflow "${runId}" has no pending or error nodes to resume.` }
  }
  // Seed = SETTLED nodes the engine should not re-run: completed (with their outputs)
  // PLUS user-skipped (no output). pending/error nodes are absent → they re-run.
  const seed = completedOutputs(record)
  for (const n of record.nodes) {
    if (n.status === 'skipped') seed.set(n.id, { id: n.id, status: 'skipped' })
  }
  return { ok: true, record, spec: record.spec, description: record.description, seed }
}
