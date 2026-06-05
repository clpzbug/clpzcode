// src/commands/workflows/index.ts
//
// The `/workflows` command (Task #11, Tranche A): inspect + manage persisted
// workflow runs written by WorkflowTool. Backed by the pure workflowsStore logic
// (list/show/kill) over ~/.clpzcode/workflows. Lazily required from commands.ts
// behind the WORKFLOW_SCRIPTS feature flag.

import type { Command } from '../../commands.js'
import type { LocalCommandCall } from '../../types/command.js'
import {
  listRuns,
  showRun,
  killRun,
  isResumable,
} from '../../tools/WorkflowTool/workflowsStore.js'
import { workflowsBaseDir } from '../../tools/WorkflowTool/persistence.js'

function fmtAge(updatedAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - updatedAt) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function renderList(baseDir: string): string {
  const runs = listRuns(baseDir)
  if (runs.length === 0) return 'No workflow runs recorded yet.'
  const lines = ['Workflow runs (newest first):', '']
  for (const r of runs) {
    const counts = `${r.done}/${r.total} done${r.errors > 0 ? ` · ${r.errors} error` : ''}`
    lines.push(`  ${r.runId}  [${r.status}]  ${counts}  ${fmtAge(r.updatedAt)}`)
    lines.push(`    ${r.description}`)
  }
  lines.push('', 'Use "/workflows show <id>" or "/workflows kill <id>".')
  return lines.join('\n')
}

function renderShow(baseDir: string, runId: string): string {
  const rec = showRun(baseDir, runId)
  if (!rec) return `No workflow run "${runId}".`
  const lines = [
    `Workflow ${rec.runId} [${rec.status}]: ${rec.description}`,
    isResumable(rec) ? '(resumable — has pending/error nodes)' : '',
    '',
  ].filter(Boolean)
  for (const n of rec.nodes) {
    const detail = n.error ? ` — ${n.error}` : ''
    lines.push(`  [${n.status}] ${n.id}${detail}`)
  }
  return lines.join('\n')
}

const call: LocalCommandCall = async args => {
  const baseDir = workflowsBaseDir()
  const parts = args.trim().split(/\s+/).filter(Boolean)
  const sub = (parts[0] ?? 'list').toLowerCase()
  const runId = parts[1]

  switch (sub) {
    case 'list':
      return { type: 'text', value: renderList(baseDir) }
    case 'show':
      if (!runId) return { type: 'text', value: 'Usage: /workflows show <id>' }
      return { type: 'text', value: renderShow(baseDir, runId) }
    case 'kill': {
      if (!runId) return { type: 'text', value: 'Usage: /workflows kill <id>' }
      const updated = killRun(baseDir, runId, Date.now())
      return {
        type: 'text',
        value: updated
          ? `Workflow ${runId} marked aborted.`
          : `No workflow run "${runId}".`,
      }
    }
    case 'resume': {
      if (!runId) return { type: 'text', value: 'Usage: /workflows resume <id>' }
      const rec = showRun(baseDir, runId)
      if (!rec) return { type: 'text', value: `No workflow run "${runId}".` }
      if (rec.status === 'running') {
        return { type: 'text', value: `Workflow ${runId} is still running — cannot resume.` }
      }
      if (!isResumable(rec)) {
        return { type: 'text', value: `Workflow ${runId} has no pending or error nodes to resume.` }
      }
      const pending = rec.nodes.filter(n => n.status === 'pending' || n.status === 'error').length
      // A local command can only return text — it can't itself launch the tool. The
      // resume DRIVER lives in WorkflowTool ({resume_runId}); surface it so the model
      // re-runs only the pending/error nodes (completed outputs are reused as the seed).
      return {
        type: 'text',
        value:
          `Workflow ${runId} is resumable: ${pending} pending/error node${pending === 1 ? '' : 's'} ` +
          `will re-run (completed nodes are reused). ` +
          `Resuming now via WorkflowTool(resume_runId="${runId}").`,
      }
    }
    default:
      // Bare id or unknown subcommand: treat a known run id as `show`, else list.
      if (showRun(baseDir, sub)) return { type: 'text', value: renderShow(baseDir, sub) }
      return { type: 'text', value: renderList(baseDir) }
  }
}

const workflows = {
  type: 'local',
  name: 'workflows',
  description: 'List, inspect, and kill multi-agent workflow runs',
  argumentHint: '[list | show <id> | resume <id> | kill <id>]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default workflows
