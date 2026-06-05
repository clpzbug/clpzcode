// Stub — snipCompact not included in source snapshot
import type { Message } from '../../types/message.js'

export const SNIP_NUDGE_TEXT = ''

export function snipCompactIfNeeded(
  messages: Message[],
  _opts?: Record<string, unknown>,
): { messages: Message[]; tokensFreed: number; boundaryMessage: Message | null } {
  return { messages, tokensFreed: 0, boundaryMessage: null }
}

export function isSnipMarkerMessage(_msg: Message): boolean { return false }
export function isSnipRuntimeEnabled(): boolean { return false }
export function shouldNudgeForSnips(_messages: Message[]): boolean { return false }
