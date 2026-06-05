// src/tools/WorkflowTool/workflowsStore.ts
//
// Backend for the `/workflows` command (Task #11, Tranche A): list / show /
// resume-prepare / mark-killed over the persisted run records (persistence.ts).
// Pure fs/JSON — the command's UI + registration are wired at integration; this
// logic is unit-testable in isolation against a temp dir.

import { readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { loadRun, saveRun, type WorkflowRunRecord, type PersistedNode } from './persistence.js'

export type RunSummary = {
  runId: string
  description: string
  status: WorkflowRunRecord['status']
  total: number
  done: number
  errors: number
  updatedAt: number
}

function summarize(r: WorkflowRunRecord): RunSummary {
  return {
    runId: r.runId,
    description: r.description,
    status: r.status,
    total: r.nodes.length,
    done: r.nodes.filter(n => n.status === 'done').length,
    errors: r.nodes.filter(n => n.status === 'error').length,
    updatedAt: r.updatedAt,
  }
}

/** All runs under baseDir, newest first. Skips unreadable/partial dirs. */
export function listRuns(baseDir: string): RunSummary[] {
  if (!existsSync(baseDir)) return []
  const summaries: RunSummary[] = []
  for (const entry of readdirSync(baseDir)) {
    const dir = join(baseDir, entry)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const rec = loadRun(baseDir, entry)
    if (rec) summaries.push(summarize(rec))
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Full record for `/workflows show <id>` (null if absent). */
export function showRun(baseDir: string, runId: string): WorkflowRunRecord | null {
  return loadRun(baseDir, runId)
}

/** Is this run resumable? (has pending/error nodes and isn't already running). */
export function isResumable(record: WorkflowRunRecord): boolean {
  if (record.status === 'running') return false
  return record.nodes.some(n => n.status === 'pending' || n.status === 'error')
}

/** Mark a (non-running) run aborted — `/workflows kill <id>`. Returns the updated
 *  record, or null if absent. Caller stamps updatedAt (no clock here). */
export function killRun(
  baseDir: string,
  runId: string,
  now: number,
): WorkflowRunRecord | null {
  const rec = loadRun(baseDir, runId)
  if (!rec) return null
  const updated: WorkflowRunRecord = {
    ...rec,
    status: 'aborted',
    nodes: rec.nodes.map(n => (n.status === 'pending' ? { ...n, status: 'skipped' } : n)),
    updatedAt: now,
  }
  saveRun(baseDir, updated)
  return updated
}

/** Persist a single node's status on a run record (used by panel skip/retry so the change
 *  survives to the next `/workflows resume`). Returns the updated record, or null if the
 *  run / node is absent. Caller stamps updatedAt. */
export function setRunNodeStatus(
  baseDir: string,
  runId: string,
  nodeId: string,
  status: PersistedNode['status'],
  now: number,
): WorkflowRunRecord | null {
  const rec = loadRun(baseDir, runId)
  if (!rec || !rec.nodes.some(n => n.id === nodeId)) return null
  const updated: WorkflowRunRecord = {
    ...rec,
    nodes: rec.nodes.map(n => (n.id === nodeId ? { ...n, status } : n)),
    updatedAt: now,
  }
  saveRun(baseDir, updated)
  return updated
}
