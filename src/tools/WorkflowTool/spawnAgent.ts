// src/tools/WorkflowTool/spawnAgent.ts
//
// The REAL spawnAgent adapter (Task #11, Tranche A integration). Wires an engine
// leaf node → runAgent: it picks the ULTRACODE/COORDINATOR built-in agent, threads
// per-node model/agentName through runAgent (provider routing is resolved inside
// runAgent via resolveAgentProvider), and — when the node declares a `schema` —
// injects createSyntheticOutputTool into the worker's tool pool and extracts the
// `structured_output` attachment from the message stream. This is the thin
// integration boundary the DI-clean runNodeFactory was built against; the
// scheduling/handoff logic lives in the unit-tested engine/runNodeFactory modules.

import type { Message } from '../../types/message.js'
import { createUserMessage } from '../../utils/messages.js'
import { runAgent } from '../AgentTool/runAgent.js'
import { createSyntheticOutputTool } from '../SyntheticOutputTool/SyntheticOutputTool.js'
import type { ToolInputJSONSchema } from '../../Tool.js'
import { ULTRACODE_AGENT } from './ultracode.js'
import { COORDINATOR_AGENT } from './coordinator.js'
import type { SpawnAgent, SpawnAgentRequest, SpawnAgentResult } from './runNodeFactory.js'

/** Pull the concatenated text of the last assistant message (matches the legacy
 *  runSubtask/runCoordinator capture). */
function lastAssistantText(messages: Message[]): string | null {
  const lastAssistant = [...messages].reverse().find(m => m.type === 'assistant')
  if (!lastAssistant || lastAssistant.type !== 'assistant') return null
  const textBlocks = lastAssistant.message.content.filter(
    (b): b is { type: 'text'; text: string } => b.type === 'text',
  )
  return textBlocks.map(b => b.text).join('\n')
}

/** Build the real SpawnAgent for a workflow run, closing over the host context. */
export function createSpawnAgent(opts: {
  workflowId: string
  toolUseContext: Parameters<typeof runAgent>[0]['toolUseContext']
  canUseTool: Parameters<typeof runAgent>[0]['canUseTool']
}): SpawnAgent {
  const { workflowId, toolUseContext, canUseTool } = opts

  return async (req: SpawnAgentRequest): Promise<SpawnAgentResult> => {
    const agentDefinition =
      req.node.type === 'coordinator' ? COORDINATOR_AGENT : ULTRACODE_AGENT

    // When the node wants typed output, hand the worker a SyntheticOutputTool
    // built from its JSON schema (provider-neutral, Ajv-validated). On an invalid
    // schema we fall back to free text rather than failing the whole node.
    let availableTools = toolUseContext.options.tools
    if (req.schema) {
      const built = createSyntheticOutputTool(req.schema as Record<string, unknown> & ToolInputJSONSchema)
      if ('tool' in built) availableTools = [...availableTools, built.tool]
    }

    const messages: Message[] = []
    let structuredOutput: unknown

    const gen = runAgent({
      agentDefinition,
      promptMessages: [createUserMessage({ content: req.prompt })],
      toolUseContext,
      canUseTool,
      isAsync: false,
      querySource: 'agent:builtin',
      availableTools,
      transcriptSubdir: `workflows/${workflowId}`,
      description: req.node.instruction ?? `Coordinate: ${workflowId}`,
      model: req.model as Parameters<typeof runAgent>[0]['model'],
      agentName: req.agentName,
    })
    for await (const msg of gen) {
      if (msg.type === 'attachment' && msg.attachment.type === 'structured_output') {
        structuredOutput = msg.attachment.data
        continue
      }
      messages.push(msg)
    }

    const text = lastAssistantText(messages)
    if (structuredOutput === undefined) {
      // A context-fill (or any API error) does NOT throw inside runAgent — the
      // harness yields a synthetic error assistant message and returns cleanly,
      // so lastAssistantText() would hand that error STRING downstream as if it
      // were a real result (the node records 'done', parallel/pipeline propagate
      // garbage to the coordinator). Detect the error flag and throw so the
      // engine records the node as 'error' per spec.
      const lastAssistant = [...messages].reverse().find(m => m.type === 'assistant')
      if (lastAssistant?.type === 'assistant' && lastAssistant.isApiErrorMessage === true) {
        throw new Error(text ?? 'agent failed with an API error')
      }
      if (text === null) {
        // No usable output — surface as an error so the engine records it per-node.
        throw new Error('agent produced no output')
      }
    }
    return { text: text ?? '', structuredOutput }
  }
}
