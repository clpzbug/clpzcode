// The clpzcode frontend imports `Agent` from here. The real implementation lives in
// src/clpz-ui/agentBridge.ts (AgentBridge), which wires the agent surface
// to the clpzcode engine. This module re-exports it under the `Agent` name the
// vendored UI expects, keeping a single source of truth (no duplicate stub).

export {
  AgentBridge as Agent,
  type AgentOptions,
  type SideQuestionResult,
  type ProcessMessageObserver,
  type ProcessMessageUsage,
  type ProcessMessageStepStart,
  type ProcessMessageStepFinish,
  type ProcessMessageToolStart,
  type ProcessMessageToolFinish,
  type ProcessMessageError,
} from '../agentBridge'
