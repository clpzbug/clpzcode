// Stub — contextCollapse not included in source snapshot (feature-gated)
import type { Message } from '../../types/message.js'

export function isContextCollapseEnabled(): boolean {
  return false
}
export function getContextCollapseState(): null {
  return null
}
export async function applyCollapsesIfNeeded(
  msgs?: Message[],
  ..._args: unknown[]
): Promise<{ messages: Message[] }> {
  return { messages: msgs ?? [] }
}
export function isWithheldPromptTooLong(..._args: unknown[]): boolean { return false }
export function recoverFromOverflow(
  _msgs?: Message[],
  ..._args: unknown[]
): { committed: number; messages: Message[] } {
  return { committed: 0, messages: _msgs ?? [] }
}
export function getStats(): { collapsedSpans: number; collapsedMessages: number; stagedSpans: number; health: { totalSpawns: number; totalErrors: number; lastError: string | null; emptySpawnWarningEmitted: boolean; totalEmptySpawns: number } } {
  return {
    collapsedSpans: 0, collapsedMessages: 0, stagedSpans: 0,
    health: { totalSpawns: 0, totalErrors: 0, lastError: null as string | null, emptySpawnWarningEmitted: false, totalEmptySpawns: 0 },
  }
}
export function subscribe(_fn: () => void): () => void { return () => {} }
export function resetContextCollapse(): void {}
export function initContextCollapse(): void {}
