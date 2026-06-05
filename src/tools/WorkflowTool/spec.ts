// src/tools/WorkflowTool/spec.ts
//
// Typed DAG spec for the model-agnostic orchestration engine (Task #11, Tranche A).
//
// Extends the legacy `{ description, subtasks[] }` declarative input into a richer
// node graph (agent / parallel / pipeline / loop / gate / coordinator) while
// staying BACKWARD-COMPATIBLE: a legacy `{ subtasks }` input desugars to `agent`
// nodes (see compile.ts). The MODEL only ever emits this declarative,
// Zod-validated JSON — never executable JS — which is the safe, provider-neutral
// orchestration contract for ANY LLM (weak models can't smuggle arbitrary code,
// and inter-node handoffs are machine-checkable). The engine that interprets the
// DAG is TypeScript we own.

import { z } from 'zod'

// A node's optional structured-output JSON Schema. Validated at runtime by
// SyntheticOutputTool (Ajv, provider-neutral) so any model can return typed data.
const jsonSchema = z.record(z.string(), z.unknown())

// ── node TypeScript types (the source of truth; the Zod schemas mirror these) ──

/** Common fields every node carries. */
type NodeBase = {
  /** Stable, unique id — used for depends_on edges, gate refs, resume + the
   *  visual tree. */
  id: string
  /** Ids of nodes that must finish before this one becomes ready. */
  dependsOn?: string[]
}

/** A single sub-agent run — the leaf unit of work. */
export type AgentNode = NodeBase & {
  type: 'agent'
  instruction: string
  /** Route to a specific provider/model per node (resolveAgentProvider). */
  agentName?: string
  model?: string
  /** Custom subagent type from the registry (e.g. 'Explore'). */
  agentType?: string
  /** JSON Schema → the node returns validated structured output. */
  schema?: Record<string, unknown>
  /** Run in a fresh git worktree (expensive; only for parallel writers). */
  isolation?: 'worktree'
  maxTurns?: number
  /** Re-run this node up to N times on failure. */
  retries?: number
}

/** Run children concurrently (bounded by `concurrency`). */
export type ParallelNode = NodeBase & {
  type: 'parallel'
  children: WorkflowNode[]
  concurrency?: number
}

/** Run steps in order; each step's typed output feeds the next. */
export type PipelineNode = NodeBase & {
  type: 'pipeline'
  steps: WorkflowNode[]
}

/** Repeat `body` over a fixed count (bounded to prevent runaway fan-out). */
export type LoopNode = NodeBase & {
  type: 'loop'
  count: number
  body: WorkflowNode
  concurrency?: number
}

/** Conditional: run `then` (else `otherwise`) based on a referenced node's output. */
export type GateNode = NodeBase & {
  type: 'gate'
  /** Node id whose output the predicate inspects. */
  ref: string
  when: { jsonPath?: string; equals?: unknown; truthy?: boolean }
  then: WorkflowNode
  otherwise?: WorkflowNode
}

/** Final integration/verification pass over upstream results. */
export type CoordinatorNode = NodeBase & {
  type: 'coordinator'
  instruction?: string
}

export type WorkflowNode =
  | AgentNode
  | ParallelNode
  | PipelineNode
  | LoopNode
  | GateNode
  | CoordinatorNode

/** A complete workflow program. */
export type WorkflowSpec = {
  description: string
  nodes: WorkflowNode[]
  /** Run a coordinator at the end (default: true for ≥2 leaf agents). */
  coordinate?: boolean
  /** Workflow-wide bounded concurrency for ready nodes. */
  maxConcurrency?: number
  /** Hard USD ceiling; the engine stops scheduling new nodes past it. */
  maxCostUsd?: number
  /** 'continue' (default) records failures and proceeds; 'fail-fast' aborts. */
  onError?: 'continue' | 'fail-fast'
}

// Caps that bound runaway fan-out (ties to the OOM concern in MEMORY.md).
export const MAX_LOOP_COUNT = 50
export const MAX_NODES = 200
export const MAX_CONCURRENCY = 16

// ── Zod schemas (mirror the types; validate model-emitted JSON, fail closed) ──

const agentNodeSchema: z.ZodType<AgentNode> = z.object({
  type: z.literal('agent'),
  id: z.string().min(1),
  instruction: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
  agentName: z.string().optional(),
  model: z.string().optional(),
  agentType: z.string().optional(),
  schema: jsonSchema.optional(),
  isolation: z.literal('worktree').optional(),
  maxTurns: z.number().int().positive().optional(),
  retries: z.number().int().min(0).max(5).optional(),
})

// Recursive container schemas resolve the node union lazily.
const parallelNodeSchema: z.ZodType<ParallelNode> = z.lazy(() =>
  z.object({
    type: z.literal('parallel'),
    id: z.string().min(1),
    dependsOn: z.array(z.string()).optional(),
    children: z.array(workflowNodeSchema).min(1),
    concurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional(),
  }),
)

const pipelineNodeSchema: z.ZodType<PipelineNode> = z.lazy(() =>
  z.object({
    type: z.literal('pipeline'),
    id: z.string().min(1),
    dependsOn: z.array(z.string()).optional(),
    steps: z.array(workflowNodeSchema).min(1),
  }),
)

const loopNodeSchema: z.ZodType<LoopNode> = z.lazy(() =>
  z.object({
    type: z.literal('loop'),
    id: z.string().min(1),
    dependsOn: z.array(z.string()).optional(),
    count: z.number().int().min(1).max(MAX_LOOP_COUNT),
    body: workflowNodeSchema,
    concurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional(),
  }),
)

const gateNodeSchema: z.ZodType<GateNode> = z.lazy(() =>
  z.object({
    type: z.literal('gate'),
    id: z.string().min(1),
    dependsOn: z.array(z.string()).optional(),
    ref: z.string().min(1),
    when: z
      .object({
        jsonPath: z.string().optional(),
        equals: z.unknown().optional(),
        truthy: z.boolean().optional(),
      })
      // An empty `when` makes evalGate fall back to Boolean(undefined) → an
      // unpredictable branch. Require at least one explicit condition.
      .refine(
        w => w.jsonPath !== undefined || w.equals !== undefined || w.truthy !== undefined,
        { message: 'gate.when needs at least one of jsonPath, equals, or truthy' },
      ),
    then: workflowNodeSchema,
    otherwise: workflowNodeSchema.optional(),
  }),
)

const coordinatorNodeSchema: z.ZodType<CoordinatorNode> = z.object({
  type: z.literal('coordinator'),
  id: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
  instruction: z.string().optional(),
})

export const workflowNodeSchema: z.ZodType<WorkflowNode> = z.lazy(() =>
  z.union([
    agentNodeSchema,
    parallelNodeSchema,
    pipelineNodeSchema,
    loopNodeSchema,
    gateNodeSchema,
    coordinatorNodeSchema,
  ]),
)

export const workflowSpecSchema: z.ZodType<WorkflowSpec> = z.object({
  description: z.string().min(1),
  nodes: z.array(workflowNodeSchema).min(1).max(MAX_NODES),
  coordinate: z.boolean().optional(),
  maxConcurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional(),
  maxCostUsd: z.number().positive().optional(),
  onError: z.enum(['continue', 'fail-fast']).optional(),
})

// ── legacy {description, subtasks[]} → WorkflowSpec (backward compatibility) ──

const legacySubtaskSchema = z.union([
  z.string(),
  z.object({
    instruction: z.string(),
    depends_on: z.array(z.number().int().min(0)).optional(),
    // Per-subtask provider/model routing (model-agnostic orchestration). Optional;
    // omitted → inherits the session default, preserving prior behavior.
    model: z.string().optional(),
    agentName: z.string().optional(),
  }),
])

export const legacyWorkflowInputSchema = z.strictObject({
  description: z.string(),
  subtasks: z.array(legacySubtaskSchema).min(1).max(20),
  coordinate: z.boolean().optional(),
})

export type LegacyWorkflowInput = z.infer<typeof legacyWorkflowInputSchema>

/** Desugar the legacy parallel/depends_on subtask array into a typed agent DAG.
 *  Each subtask i becomes an `agent` node with id `s{i}`; numeric depends_on
 *  indices become `s{j}` id edges. Behavior is identical to computeWaves. */
export function legacyToSpec(input: LegacyWorkflowInput): WorkflowSpec {
  const nodes: WorkflowNode[] = input.subtasks.map((s, i) => {
    const instruction = typeof s === 'string' ? s : s.instruction
    const deps = typeof s === 'string' ? [] : (s.depends_on ?? [])
    const model = typeof s === 'string' ? undefined : s.model
    const agentName = typeof s === 'string' ? undefined : s.agentName
    return {
      type: 'agent',
      id: `s${i}`,
      instruction,
      // Honour only backward refs (j < i) — matches the legacy cycle-free model.
      dependsOn: deps.filter(j => j >= 0 && j < i).map(j => `s${j}`),
      ...(model !== undefined ? { model } : {}),
      ...(agentName !== undefined ? { agentName } : {}),
    }
  })
  return {
    description: input.description,
    nodes,
    coordinate: input.coordinate,
  }
}
