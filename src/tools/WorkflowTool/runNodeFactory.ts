// src/tools/WorkflowTool/runNodeFactory.ts
//
// Builds the engine's injected `runNode` from a `spawnAgent` primitive (Task #11,
// Tranche A). Kept DI-clean: it does NOT import the heavy runAgent module — the
// REAL spawnAgent (wiring runAgent + the model-agnostic SyntheticOutputTool for a
// node's `schema`, + per-node model/agentName via resolveAgentProvider) is a thin
// adapter injected at the WorkflowTool integration boundary. So the prompt-build +
// handoff + output-mapping logic here is unit-testable with a mock spawnAgent and
// needs no dist build.

import type { AgentNode, CoordinatorNode } from './spec.js'
import type { NodeRunContext, RunNode } from './engine.js'

export type SpawnAgentRequest = {
  node: AgentNode | CoordinatorNode
  prompt: string
  /** JSON Schema for structured output (from an agent node's `schema`). */
  schema?: Record<string, unknown>
  /** Per-node provider routing (resolved by the real spawnAgent). */
  model?: string
  agentName?: string
  signal?: AbortSignal
}

export type SpawnAgentResult = { text: string; structuredOutput?: unknown }

export type SpawnAgent = (req: SpawnAgentRequest) => Promise<SpawnAgentResult>

const UPSTREAM_HEADER = 'Output from prerequisite step(s):'
const SCHEMA_HINT =
  'Return your final result as structured output matching the provided JSON schema.'
const COORDINATOR_DEFAULT =
  'Integrate the results of the prior steps: resolve conflicts, run the tests/build/typecheck, and verify correctness.'

/** Compose a node's prompt: its instruction + any upstream (pipeline/dep) outputs
 *  + a structured-output hint when the node declares a schema. */
export function buildNodePrompt(
  node: AgentNode | CoordinatorNode,
  ctx: NodeRunContext,
): string {
  const parts: string[] = []
  parts.push(node.instruction ?? (node.type === 'coordinator' ? COORDINATOR_DEFAULT : ''))

  if (ctx.upstream.length > 0) {
    const blocks = ctx.upstream.map(u => {
      const body =
        u.output !== undefined ? JSON.stringify(u.output, null, 2) : (u.text ?? '')
      return `### ${u.id}\n${body}`
    })
    parts.push(`${UPSTREAM_HEADER}\n${blocks.join('\n\n')}`)
  }

  if (node.type === 'agent' && node.schema) parts.push(SCHEMA_HINT)

  return parts.filter(Boolean).join('\n\n')
}

export function makeRunNode(spawnAgent: SpawnAgent): RunNode {
  return async (node, ctx, modelOverride) => {
    const prompt = buildNodePrompt(node, ctx)
    const schema = node.type === 'agent' ? node.schema : undefined
    // A resilience fallback retry overrides the node's configured model.
    const model = modelOverride ?? (node.type === 'agent' ? node.model : undefined)
    const agentName = node.type === 'agent' ? node.agentName : undefined
    const r = await spawnAgent({ node, prompt, schema, model, agentName, signal: ctx.signal })
    return { text: r.text, output: r.structuredOutput }
  }
}
