/**
 * Relevance-Based Context Pruning
 *
 * Prunes context to keep only messages relevant to the current task.
 * Groups messages by API round to preserve tool_use/tool_result pairing.
 */

import { roughTokenCountEstimationForMessages } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'
import { groupMessagesByApiRound } from '../services/compact/grouping.js'

export interface PruningOptions {
  targetTokens: number
  taskContext?: string
  minRelevanceScore?: number
  preserveRecent?: number
  preserveTools?: boolean
  preserveErrors?: boolean
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'they', 'will', 'would',
])

function extractKeywords(text: string): Set<string> {
  const keywords = new Set<string>()
  for (const word of text.toLowerCase().split(/\s+/)) {
    const cleaned = word.replace(/[^a-z]/g, '')
    if (cleaned.length > 3 && !STOP_WORDS.has(cleaned)) keywords.add(cleaned)
  }
  return keywords
}

function jaccard(text1: string, text2: string): number {
  const k1 = extractKeywords(text1)
  const k2 = extractKeywords(text2)
  let overlap = 0
  for (const k of k1) if (k2.has(k)) overlap++
  const union = k1.size + k2.size - overlap
  return union > 0 ? overlap / union : 0
}

function getMessageText(message: Message): string {
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: unknown) => {
      if (typeof block !== 'object' || block === null) return ''
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') return b.text as string
      if (b.type === 'tool_result') {
        const inner = b.content
        if (typeof inner === 'string') return inner
        if (Array.isArray(inner)) {
          return inner
            .map((i: unknown) =>
              typeof i === 'object' && i !== null && (i as Record<string, unknown>).type === 'text'
                ? String((i as Record<string, unknown>).text ?? '')
                : '',
            )
            .join(' ')
        }
      }
      return ''
    })
    .join(' ')
}

export function hasToolCalls(message: Message): boolean {
  const content = message.message?.content
  if (Array.isArray(content)) {
    return content.some(
      (block: unknown) =>
        typeof block === 'object' &&
        block !== null &&
        ((block as Record<string, unknown>).type === 'tool_use' ||
          (block as Record<string, unknown>).type === 'tool_result'),
    )
  }
  if (typeof content === 'string') {
    return content.includes('tool_use') || content.includes('tool_result')
  }
  return false
}

export function hasErrors(message: Message): boolean {
  const content = message.message?.content
  if (Array.isArray(content)) {
    return content.some(
      (block: unknown) =>
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>).type === 'tool_result' &&
        (block as Record<string, unknown>).is_error === true,
    )
  }
  const text = getMessageText(message).toLowerCase()
  return text.includes('error') || text.includes('fail') || text.includes('exception')
}

export function calculateRelevance(message: Message, options: PruningOptions): number {
  let score = 0.5

  if (options.taskContext) {
    score += jaccard(getMessageText(message), options.taskContext) * 0.3
  }

  if (options.preserveTools && hasToolCalls(message)) score += 0.25
  if (options.preserveErrors && hasErrors(message)) score += 0.3
  if (message.message?.role === 'user') score += 0.1

  return Math.min(1, score)
}

export function pruneByRelevance(messages: Message[], options: PruningOptions): Message[] {
  const preserveRecent = options.preserveRecent ?? 3

  if (messages.length <= preserveRecent) return messages

  const recentMessages = messages.slice(-preserveRecent)
  const olderMessages = messages.slice(0, -preserveRecent)

  const olderGroups = groupMessagesByApiRound(olderMessages)

  const scored = olderGroups.map(group => ({
    group,
    score: group.reduce((sum, m) => sum + calculateRelevance(m, options), 0) / group.length,
    tokens: roughTokenCountEstimationForMessages(group),
  }))

  // Higher score wins; break ties by preferring more recent groups (index order)
  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.01) return b.score - a.score
    return olderGroups.indexOf(b.group) - olderGroups.indexOf(a.group)
  })

  const result: Message[] = [...recentMessages]
  let usedTokens = 0

  for (const { group, tokens } of scored) {
    if (usedTokens + tokens > options.targetTokens) continue
    result.push(...group)
    usedTokens += tokens
  }

  // Restore original order
  const olderSet = new Set(olderMessages)
  const olderKept = olderMessages.filter(m => result.includes(m) && olderSet.has(m))
  return [...olderKept, ...recentMessages]
}

export function getTopRelevantMessages(
  messages: Message[],
  options: PruningOptions,
  limit = 10,
): Message[] {
  return messages
    .map(msg => ({ msg, score: calculateRelevance(msg, options) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.msg)
}

export function getRelevanceStats(
  messages: Message[],
  options: PruningOptions,
): { averageScore: number; highRelevanceCount: number; toolCallCount: number; errorCount: number } {
  const scores = messages.map(msg => calculateRelevance(msg, options))
  return {
    averageScore: scores.length > 0 ? scores.reduce((s, x) => s + x, 0) / scores.length : 0,
    highRelevanceCount: scores.filter(s => s > 0.7).length,
    toolCallCount: messages.filter(hasToolCalls).length,
    errorCount: messages.filter(hasErrors).length,
  }
}
