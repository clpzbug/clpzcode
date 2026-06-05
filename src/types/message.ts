/**
 * Stub — message type definitions not included in source snapshot.
 *
 * The upstream Anthropic source defines a rich Message discriminated union
 * with structured Content blocks, role tags, tool_use payloads, and so on.
 * That file is not mirrored to this open snapshot. This stub exists so
 * `tsc --noEmit` can resolve `import { Message, ... } from 'src/types/message'`
 * across the ~21 callers without fixing every transitive type the call
 * sites use.
 *
 * Once the real definitions are restored upstream-side or reconstructed
 * from runtime usage, replace these `any` aliases with proper types and
 * delete this comment. See issue #473 for the typecheck-foundation effort.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Message = any
export type AssistantMessage = any
export type UserMessage = any
export type SystemMessage = any
export type SystemAPIErrorMessage = any
export type AttachmentMessage<T = any> = any
export type HookResultMessage = any
export type NormalizedUserMessage = any

// ProgressMessage must be generic — callers use ProgressMessage<T> throughout.
export type ProgressMessage<P = any> = {
  type: 'progress'
  data: P
  toolUseID: string
  parentToolUseID: string
  uuid: string
  timestamp: string
}

// Aliases for names callers expect (not in the original stub)
export type NormalizedMessage = NormalizedUserMessage
export type NormalizedAssistantMessage<T = any> = any
export type RenderableMessage = any
export type CollapsibleMessage = any
export type CollapsedReadSearchGroup = any
export type GroupedToolUseMessage = any
export type CompactMetadata = any
export type MessageOrigin = any
export type PartialCompactDirection = any

// System message subtypes

import type { UUID } from 'crypto'

/** Compact boundary marker inserted into the message stream after a full compaction. */
export interface SystemCompactBoundaryMessage {
  type: 'system'
  subtype: 'compact_boundary'
  content: string
  isMeta: boolean
  timestamp: string
  uuid: string
  level: 'info'
  compactMetadata: {
    trigger: 'manual' | 'auto'
    preTokens: number
    postTokens?: number
    userContext?: string
    messagesSummarized?: number
    /** Tool names discovered before compaction, stored for post-compact injection. */
    preCompactDiscoveredTools?: string[]
    /** Present on reactive-compact boundaries: UUID range of the kept tail segment. */
    preservedSegment?: {
      headUuid: UUID
      anchorUuid: UUID
      tailUuid: UUID
    }
  }
  logicalParentUuid?: string
}

/** Microcompact boundary marker inserted when old tool results are cleared. */
export interface SystemMicrocompactBoundaryMessage {
  type: 'system'
  subtype: 'microcompact_boundary'
  content: string
  isMeta: boolean
  timestamp: string
  uuid: string
  level: 'info'
  microcompactMetadata: {
    trigger: 'auto'
    preTokens: number
    tokensSaved: number
    compactedToolIds: string[]
    clearedAttachmentUUIDs: string[]
  }
}

export type SystemInformationalMessage = any
export type SystemLocalCommandMessage = any
export type SystemMemorySavedMessage = any
export type SystemBridgeStatusMessage = any
export type SystemBridgeMessage = any
export type SystemFileSnapshotMessage = any
export type SystemTurnDurationMessage = any
export type SystemStopHookSummaryMessage = any
export type SystemThinkingMessage = any
export type SystemApiMetricsMessage = any
export type SystemMessageLevel = any
export type SystemAgentsKilledMessage = any
export type SystemAwaySummaryMessage = any
export type SystemPermissionRetryMessage = any
export type SystemScheduledTaskFireMessage = any

// Query / stream event types
export type StreamEvent = any
export type RequestStartEvent = any
export type TombstoneMessage = any
export type ToolUseSummaryMessage = any
export type StopHookInfo = any
