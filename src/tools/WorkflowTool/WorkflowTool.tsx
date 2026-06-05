import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { THINK_FRAMES } from '../../constants/animGlyphs.js'
import { generateTaskId, createTaskStateBase } from '../../Task.js'
import { createChildAbortController } from '../../utils/abortController.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'
import { getTotalCost } from '../../cost-tracker.js'
import { runWorkflow, type WorkflowEvent, type NodeResult } from './engine.js'
import { compileSpec } from './compile.js'
import {
  legacyToSpec,
  type WorkflowSpec,
  type CoordinatorNode,
  type LegacyWorkflowInput,
} from './spec.js'
import { makeRunNode } from './runNodeFactory.js'
import { resolveFallbackChain } from './resilience.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { getVendorForModel } from '../../utils/model/multiProviderOptions.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { resolveResume } from './resume.js'
import { createSpawnAgent } from './spawnAgent.js'
import {
  saveRun,
  workflowsBaseDir,
  type WorkflowRunRecord,
  type PersistedNode,
} from './persistence.js'
import { initRunState, applyEvent, progressLine } from './runState.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'

// ── Schema ────────────────────────────────────────────────────────────────────

const subtaskSchema = z.union([
  z.string(),
  z.object({
    instruction: z.string().describe('What this agent must accomplish'),
    depends_on: z
      .array(z.number().int().min(0))
      .optional()
      .describe(
        'Zero-based indices of earlier subtasks that must finish before this one starts. Omit or [] for immediate parallel execution.',
      ),
    model: z
      .string()
      .optional()
      .describe(
        'Optional per-subtask model/provider (e.g. a cheaper model for simple subtasks). Omit to inherit the session default.',
      ),
    agentName: z
      .string()
      .optional()
      .describe('Optional named agent profile to route this subtask to. Omit for the default.'),
  }),
])

const inputSchema = z.strictObject({
  description: z
    .string()
    .optional()
    .describe('High-level description of the overall workflow goal (omit when resuming)'),
  subtasks: z
    .array(subtaskSchema)
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Subtasks to execute. Plain strings run immediately in parallel. Use {instruction, depends_on: [i, j]} for sequential ordering — the subtask starts only after subtasks i and j finish. Omit when resuming.',
    ),
  coordinate: z
    .boolean()
    .optional()
    .describe(
      'Run a coordinator agent after all subtasks to integrate results, resolve conflicts, run tests/build, and verify correctness. Defaults to true for 2+ subtasks.',
    ),
  resume_runId: z
    .string()
    .optional()
    .describe(
      'Resume a prior workflow run by its id (from /workflows list): re-runs ONLY its pending/error nodes, reusing the completed nodes\' outputs. When set, description/subtasks are ignored.',
    ),
})

type WorkflowInput = z.infer<typeof inputSchema>
type WorkflowOutput = string

// ── Spec construction ─────────────────────────────────────────────────────────
// The model-emitted {description, subtasks, coordinate} input is desugared into a
// typed agent DAG (legacyToSpec, ids s0..sN) and, when coordination is on, capped
// with an explicit `coordinator` node depending on every agent node — preserving
// the legacy "coordinator runs once after all subtasks" behavior.

const COORDINATOR_NODE_ID = 'coordinator'

function buildSpec(input: LegacyWorkflowInput): {
  spec: WorkflowSpec
  agentIds: string[]
  hasCoordinator: boolean
} {
  const base = legacyToSpec(input)
  const agentIds = base.nodes.map(n => n.id)
  // Default on for ≥2 subtasks; explicit flag overrides (matches legacy :351).
  const shouldCoordinate =
    input.coordinate === true || (input.coordinate !== false && agentIds.length >= 2)
  if (!shouldCoordinate) {
    return { spec: { ...base, coordinate: false }, agentIds, hasCoordinator: false }
  }
  const coordinator: CoordinatorNode = {
    type: 'coordinator',
    id: COORDINATOR_NODE_ID,
    dependsOn: agentIds,
  }
  return {
    spec: { ...base, coordinate: true, nodes: [...base.nodes, coordinator] },
    agentIds,
    hasCoordinator: true,
  }
}

// Number of subtask-only waves (excludes the coordinator), for the legacy report
// header's "| N waves" suffix. Computed off the agent-only spec.
function subtaskWaveCount(input: LegacyWorkflowInput): number {
  const agentSpec = legacyToSpec(input)
  const compiled = compileSpec(agentSpec)
  return compiled.ok ? compiled.waves.length : 1
}

// ── Result formatting ─────────────────────────────────────────────────────────

/** A subtask's display result, mapped from the engine's NodeResult. */
function subtaskResultText(r: NodeResult | undefined): { result: string; ok: boolean } {
  if (!r) return { result: '(agent produced no output)', ok: false }
  if (r.status === 'done') {
    const body =
      r.output !== undefined
        ? JSON.stringify(r.output, null, 2)
        : (r.text ?? '')
    return { result: body || '(no text output)', ok: true }
  }
  if (r.status === 'skipped') {
    return { result: r.error ? `SKIPPED: ${r.error}` : 'SKIPPED', ok: false }
  }
  return { result: `ERROR: ${r.error ?? 'unknown error'}`, ok: false }
}

// ── Persistence helpers ───────────────────────────────────────────────────────

function persistedNodesFrom(
  spec: WorkflowSpec,
  results: Map<string, NodeResult>,
  viewStatus: Map<string, PersistedNode['status']>,
): PersistedNode[] {
  return spec.nodes.map(n => {
    // Prefer the full result (captured at run end) for output/error; during the
    // run only live statuses are known, so fall back to the view's status.
    const r = results.get(n.id)
    if (r) return { id: n.id, status: r.status, output: r.output, text: r.text, error: r.error }
    return { id: n.id, status: viewStatus.get(n.id) ?? 'pending' }
  })
}

// ── WorkflowTool ─────────────────────────────────────────────────────────────

export const WorkflowTool = buildTool({
  maxResultSizeChars: 200_000,
  name: WORKFLOW_TOOL_NAME,
  searchHint: 'dynamic workflow, parallel execution, ultracode fleet, decompose task, coordinator, depends_on',

  async description() {
    return 'Decompose a complex task and execute subtasks in parallel using a fleet of high-powered ultracode agents. Each agent has full tool access and can spawn its own sub-agents. Supports sequential dependency ordering between subtasks (depends_on). A coordinator agent then integrates results, resolves conflicts, runs tests/build, and verifies correctness.'
  },

  async prompt() {
    return `Use WorkflowTool when:
- The user's request contains the word "workflow"
- The task naturally decomposes into ≥2 independent parallel workstreams
- Multiple files/features can be updated concurrently

## Subtask format
Each subtask is a plain string (parallel, no dependencies) or an object:

\`\`\`json
{
  "description": "Add JWT auth to the API",
  "subtasks": [
    "Create src/auth/types.ts with User, Session, and JWTPayload types",
    {"instruction": "Implement JWT middleware in src/middleware/auth.ts", "depends_on": [0]},
    {"instruction": "Add /login and /refresh endpoints in src/api/auth.ts", "depends_on": [0]},
    {"instruction": "Write integration tests for all auth endpoints", "depends_on": [1, 2]}
  ]
}
\`\`\`

Subtasks without depends_on run in parallel. Subtasks with depends_on wait for their prerequisites, then run in parallel with other same-wave tasks. This allows expressing a dependency DAG: independent tasks go wide, sequential tasks go deep.

## Coordinator (default: on for 2+ subtasks)
After all subtasks complete, a coordinator agent:
1. Runs git diff to review all changes
2. Detects and resolves conflicts between subtasks
3. Runs tests, build, and type checker — fixes failures
4. Verifies end-to-end correctness and integration gaps
5. Reports what passed, what was fixed, and any remaining issues

Set \`coordinate: false\` to skip (useful for independent tasks that can't conflict).

## What agents can do
Each ultracode agent has full tool access: file read/write/edit, bash, glob, grep, and the Agent tool to spawn its own sub-agents for parallel or specialized sub-problems.`
  },

  get inputSchema() {
    return inputSchema
  },

  renderToolUseMessage(input: Partial<WorkflowInput>) {
    const { description = '', subtasks = [] } = input
    const count = subtasks.length || '?'
    return description ? `${description} (ultracode ×${count})` : `ultracode ×${count}`
  },

  renderToolUseProgressMessage() {
    return (
      <MessageResponse height={1}>
        <Box flexDirection="row" gap={1}>
          <AnimatedGlyph frames={THINK_FRAMES} interval={80} loops={0} />
          <Text dimColor>Parallel agents running…</Text>
        </Box>
      </MessageResponse>
    )
  },

  mapToolResultToToolResultBlockParam(result: WorkflowOutput, toolUseID: string) {
    return {
      type: 'tool_result' as const,
      content: result,
      tool_use_id: toolUseID,
    }
  },

  async call(input, toolUseContext, canUseTool) {
    const baseDir = workflowsBaseDir()

    // Two entry paths: a fresh run (description+subtasks) or a RESUME of a prior run
    // (resume_runId → re-run only its pending/error nodes, reusing completed outputs).
    let description: string
    let runId: string
    let spec: WorkflowSpec
    let agentIds: string[]
    let hasCoordinator: boolean
    let seed: ReadonlyMap<string, NodeResult> | undefined
    // The narrowed fresh input (for the report's wave count); undefined on resume.
    let freshInput: LegacyWorkflowInput | undefined

    if (input.resume_runId) {
      const res = resolveResume(baseDir, input.resume_runId)
      if (!res.ok) return { data: res.message }
      description = res.description
      runId = input.resume_runId
      spec = res.spec
      agentIds = spec.nodes.filter(n => n.type === 'agent').map(n => n.id)
      hasCoordinator = spec.nodes.some(n => n.id === COORDINATOR_NODE_ID)
      seed = res.seed
    } else {
      if (!input.description || !input.subtasks?.length) {
        return { data: 'Workflow requires `description` + `subtasks`, or a `resume_runId`.' }
      }
      description = input.description
      runId = Math.random().toString(36).slice(2, 10)
      freshInput = {
        description: input.description,
        subtasks: input.subtasks,
        coordinate: input.coordinate,
      }
      const built = buildSpec(freshInput)
      spec = built.spec
      agentIds = built.agentIds
      hasCoordinator = built.hasCoordinator
    }
    const total = agentIds.length

    // Reject a malformed plan before any agent runs (fail closed).
    const compiled = compileSpec(spec)
    if (!compiled.ok) {
      return { data: `# Workflow rejected: ${description}\nInvalid workflow: ${compiled.errors.join('; ')}` }
    }

    // Instruction text per node id, read from the spec node so it works for both the
    // fresh and resume paths (resume has no input.subtasks).
    const instructionFor = (id: string): string => {
      if (id === COORDINATOR_NODE_ID) return 'Coordinator'
      const node = spec.nodes.find(n => n.id === id)
      return node && node.type === 'agent' ? node.instruction : id
    }

    // Renderer-agnostic view state folded from engine events, mirrored into the
    // LocalWorkflowTask so the Ink progress view / detail dialog render live.
    let view = initRunState(spec.nodes.map(n => n.id))
    const results = new Map<string, NodeResult>()

    // Persistence + live AppState surface, updated on every node transition.
    // setAppStateForTasks reaches the root store even from nested async contexts.
    const setAppState = toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState
    const taskId = generateTaskId('local_workflow')
    // Child of the turn controller: a turn interrupt stops the workflow, and the
    // panel/stopTask can abort just this run independently (killWorkflowTask).
    const abortController = createChildAbortController(toolUseContext.abortController)
    const initialTask: LocalWorkflowTaskState = {
      ...createTaskStateBase(taskId, 'local_workflow', description, toolUseContext.toolUseId),
      type: 'local_workflow',
      status: 'running',
      runId, // persistence id — lets panel skip/retry update the on-disk record
      summary: description,
      agents: spec.nodes.map(n => ({ id: n.id, subtask: instructionFor(n.id), status: 'pending' })),
      abortController,
    }
    registerTask(initialTask, setAppState)

    const record: WorkflowRunRecord = {
      runId,
      description,
      status: 'running',
      spec,
      nodes: spec.nodes.map(n => ({ id: n.id, status: 'pending' as const })),
      updatedAt: Date.now(),
    }
    const persist = () => {
      // Map the live view statuses ('running' has no persisted form → 'pending').
      const viewStatus = new Map<string, PersistedNode['status']>(
        view.nodes.map(n => [n.id, n.status === 'running' ? 'pending' : n.status]),
      )
      record.nodes = persistedNodesFrom(spec, results, viewStatus)
      record.updatedAt = Date.now()
      try {
        saveRun(baseDir, record)
      } catch {
        // Persistence is best-effort; never fail the run on a disk error.
      }
    }
    saveRun(baseDir, record) // initial snapshot

    const onEvent = (e: WorkflowEvent) => {
      view = applyEvent(view, e)
      if (e.type === 'node-done') {
        updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, t => ({
          ...t,
          summary: `${description} — ${progressLine(view)}`,
          agents: t.agents.map(a =>
            a.id === e.id ? { ...a, status: e.status } : a,
          ),
        }))
        persist()
      } else if (e.type === 'node-start') {
        updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, t => ({
          ...t,
          agents: t.agents.map(a =>
            a.id === e.id ? { ...a, status: 'running' } : a,
          ),
        }))
      } else if (e.type === 'wave') {
        updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, t => ({
          ...t,
          summary: `${description} — ${progressLine(view)}`,
        }))
      }
    }

    const spawnAgent = createSpawnAgent({ workflowId: runId, toolUseContext, canUseTool })
    const baseRunNode = makeRunNode(spawnAgent)
    const runResult = await runWorkflow(spec, {
      // Capture each leaf's output into the tool's `results` map AS IT COMPLETES,
      // so the mid-run persist() (driven by node-done) writes real outputs — not
      // just status. Previously `results` was only filled AFTER runWorkflow
      // returned (below), so a crash mid-run left a record with empty handoffs
      // that resume could not actually use.
      runNode: async (node, ctx, modelOverride) => {
        const r = await baseRunNode(node, ctx, modelOverride)
        results.set(node.id, { id: node.id, status: 'done', output: r.output, text: r.text })
        return r
      },
      onEvent,
      costUsd: getTotalCost,
      seed,
      // Without this the engine's abort guards never fire — turn interrupt and
      // panel cancel would not stop in-flight waves/nodes.
      signal: abortController.signal,
      // Resilience: a node that keeps failing falls back to a configured model,
      // and finally to the main-loop model — so one agent's error never stalls
      // the run. Settings may pin an explicit chain via `modelFallbacks`.
      fallbackModels: primary =>
        resolveFallbackChain(
          primary,
          (getInitialSettings() as { modelFallbacks?: string[] } | null)?.modelFallbacks,
          toolUseContext.options.mainLoopModel,
          3,
          // Only offer fallbacks this process can actually route per-request: xAI
          // targets always (providerOverride), Anthropic-native targets only when
          // the ambient provider env isn't pinned to an OpenAI-compat vendor —
          // otherwise an Anthropic id would be misrouted to the xAI endpoint.
          m => getVendorForModel(m) === 'xai' || !isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI),
        ),
      onLog: msg => logForDebugging(`[workflow:resilience] ${msg}`),
    })
    for (const r of runResult.results) results.set(r.id, r)

    // Final persistence + task status.
    record.status =
      runResult.status === 'aborted' ? 'aborted' : runResult.status
    persist()
    updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, t => ({
      ...t,
      status: runResult.status === 'completed' ? 'completed' : 'failed',
      endTime: Date.now(),
      summary: `${description} — ${progressLine(view)}`,
    }))

    // ── Build the markdown report (same shape as the legacy executor) ──
    const subtaskResults = agentIds.map((id, index) => ({
      index,
      instruction: instructionFor(id),
      ...subtaskResultText(results.get(id)),
    }))

    const failed = subtaskResults.filter(r => !r.ok).length
    // Resume has no input.subtasks → derive wave count from the compiled spec.
    const waveCount = freshInput ? subtaskWaveCount(freshInput) : compiled.waves.length
    const waveSummary = waveCount > 1 ? ` | ${waveCount} waves` : ''
    const lines: string[] = [
      `# Workflow complete: ${description}`,
      `id=${runId} | ${total} agent${total === 1 ? '' : 's'}${waveSummary} | ${failed === 0 ? 'all OK' : `${failed} failed`}`,
      ``,
    ]

    for (const r of subtaskResults) {
      lines.push(`## Subtask ${r.index + 1}/${total}: ${r.instruction}`)
      if (!r.ok) lines.push(`⚠ Status: FAILED`)
      lines.push(r.result)
      lines.push(``)
    }

    if (hasCoordinator) {
      const c = subtaskResultText(results.get(COORDINATOR_NODE_ID))
      lines.push(`## Coordinator report`, c.result)
    }

    return { data: lines.join('\n') }
  },
} satisfies ToolDef<typeof inputSchema, WorkflowOutput>)
