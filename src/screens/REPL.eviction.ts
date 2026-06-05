/**
 * Message-content eviction helpers.
 *
 * Extracted to a leaf module (no REPL/React/tool imports) so the companion
 * test file can import them without triggering the full REPL dependency tree.
 * REPL.tsx re-exports both functions from here.
 */

import type { Message as MessageType } from '../types/message.js'

// Same value as TIME_BASED_MC_CLEARED_MESSAGE in microCompact.ts.
// Duplicated here to keep this module dep-free. A test in microCompact.test.ts
// asserts equality with the source of truth to catch drift.
const MC_CLEARED = '[Old tool result content cleared]'

// File-mutation tools whose tool_use.input carries the full written/edited file
// payload. Once their tool_result has landed, that payload is dead weight in
// React state — the bytes are on disk and the renderer only needs file_path /
// notebook_path for the message header. Names match the tool constants
// (FILE_WRITE_TOOL_NAME, FILE_EDIT_TOOL_NAME, MULTI_EDIT_TOOL_NAME,
// NOTEBOOK_EDIT_TOOL_NAME); inlined here to keep this module dep-free.
const FILE_MUTATION_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

// Strip heavy text fields from a completed file-mutation tool_use.input while
// preserving the path the renderer reads for the header. Returns the original
// input if nothing changed (so callers can keep object identity).
function stripFileMutationInput(input: any): any {
  if (input == null || typeof input !== 'object') return input
  let touched = false
  const out: any = { ...input }
  // Write: content. Edit: old_string/new_string. NotebookEdit: new_source.
  for (const key of ['content', 'old_string', 'new_string', 'new_source']) {
    if (typeof out[key] === 'string' && out[key].length > 0) {
      out[key] = ''
      touched = true
    }
  }
  // MultiEdit: edits[] each carry old_string/new_string blobs.
  if (Array.isArray(out.edits)) {
    out.edits = out.edits.map((e: any) => {
      if (e == null || typeof e !== 'object') return e
      const ne = { ...e }
      if (typeof ne.old_string === 'string' && ne.old_string.length > 0) {
        ne.old_string = ''
        touched = true
      }
      if (typeof ne.new_string === 'string' && ne.new_string.length > 0) {
        ne.new_string = ''
        touched = true
      }
      return ne
    })
  }
  return touched ? out : input // file_path / notebook_path are left untouched
}

// Evict heavy content from messages older than the 2 most recent turns:
// ephemeral progress payloads, extended-thinking text, tool_result strings,
// and completed file-mutation tool_use.input blobs (Write/Edit/MultiEdit/
// NotebookEdit). The API pipeline uses messagesForQuery (managed by
// microcompact), not this React state, so eviction here has zero impact on
// Claude's context.
export function evictOldMessageContent(prev: MessageType[]): MessageType[] {
  // Locate the eviction boundary: index of the 2nd-to-last assistant message.
  // Everything before that index is old enough to have its content evicted.
  let assistantCount = 0
  let boundaryIdx = 0
  for (let i = prev.length - 1; i >= 0; i--) {
    if ((prev[i] as any).type === 'assistant') {
      assistantCount++
      if (assistantCount >= 2) {
        boundaryIdx = i
        break
      }
    }
  }
  if (boundaryIdx === 0) return prev // fewer than 2 completed turns yet

  // Tool_use ids that already have a tool_result anywhere in the transcript.
  // Only completed file-mutation tool_uses get their input stripped — an
  // in-flight write/edit still needs its input if it has to be re-rendered or
  // retried before the result lands.
  const completedToolUseIds = new Set<string>()
  for (const msg of prev) {
    if ((msg as any).type !== 'user') continue
    const content = (msg as any).message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        completedToolUseIds.add(block.tool_use_id)
      }
    }
  }

  let changed = false
  const next = prev.map((msg, i) => {
    if (i >= boundaryIdx) return msg // keep the 2 most recent turns intact
    // Evict ALL progress message data that is old enough (before boundary).
    // This includes ephemeral types (bash_progress, mcp_progress) AND
    // non-ephemeral types (agent_progress, skill_progress, hook_progress).
    if ((msg as any).type === 'progress' && !(msg as any).data?.evicted) {
      changed = true
      return { ...msg, data: { type: (msg as any).data?.type, evicted: true } }
    }
    // Evict thinking block text AND completed file-mutation tool_use.input from
    // old assistant messages.
    if ((msg as any).type === 'assistant') {
      const content = (msg as any).message?.content
      if (!Array.isArray(content)) return msg
      let touched = false
      const newContent = content.map((block: any) => {
        if (block.type === 'thinking' && block.thinking) {
          touched = true
          return { ...block, thinking: '' }
        }
        // Strip the heavy file payload from a completed Write/Edit/MultiEdit/
        // NotebookEdit tool_use, keeping file_path for the renderer header.
        if (
          block.type === 'tool_use' &&
          FILE_MUTATION_TOOLS.has(block.name) &&
          completedToolUseIds.has(block.id)
        ) {
          const stripped = stripFileMutationInput(block.input)
          if (stripped !== block.input) {
            touched = true
            return { ...block, input: stripped }
          }
        }
        return block
      })
      if (!touched) return msg
      changed = true
      return { ...msg, message: { ...(msg as any).message, content: newContent } }
    }
    if ((msg as any).type !== 'user') return msg
    const content = (msg as any).message?.content
    if (!Array.isArray(content)) return msg
    let touched = false
    const newContent = content.map((block: any) => {
      if (block.type === 'tool_result' && block.content !== MC_CLEARED) {
        touched = true
        return { ...block, content: MC_CLEARED }
      }
      return block
    })
    if (!touched) return msg
    changed = true
    return {
      ...msg,
      message: { ...(msg as any).message, content: newContent },
      toolUseResult: undefined,
    }
  })
  return changed ? next : prev
}

/**
 * Mid-turn eviction: clears data from progress messages whose parent tool use
 * has already completed (a tool_result block for that ID exists in messages).
 *
 * Supplements evictOldMessageContent, which requires ≥2 completed assistant
 * turns before doing anything. In a single long turn (e.g. a pentest running
 * 10+ sub-agents without user input) the turn boundary never advances, so
 * evictOldMessageContent is a no-op. This function fills that gap: as each
 * agent finishes and its tool_result lands, its progress messages get evicted
 * regardless of how many turns have elapsed.
 *
 * Safe to call at any time — running agents have no tool_result yet, so they
 * are never touched.
 */
export function evictCompletedAgentProgress(
  prev: MessageType[],
): MessageType[] {
  // Collect tool_use_ids that have a corresponding tool_result (agent done).
  const completedIds = new Set<string>()
  for (const msg of prev) {
    if ((msg as any).type !== 'user') continue
    const content = (msg as any).message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        completedIds.add(block.tool_use_id)
      }
    }
  }
  if (completedIds.size === 0) return prev

  let changed = false
  const next = prev.map(msg => {
    if (
      (msg as any).type !== 'progress' ||
      (msg as any).data?.evicted ||
      !completedIds.has((msg as any).parentToolUseID)
    ) {
      return msg
    }
    changed = true
    return { ...msg, data: { type: (msg as any).data?.type, evicted: true } }
  })
  return changed ? next : prev
}
