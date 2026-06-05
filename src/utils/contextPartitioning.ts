/**
 * Context Window Partitioning
 *
 * Splits context into priority zones with different retention policies.
 * Used for analysis and intelligent context management when needed.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export type PriorityZone = 'recent' | 'important' | 'background' | 'system'

export interface ZoneConfig {
  name: PriorityZone
  maxTokens: number
  retentionPolicy: 'keep_all' | 'prune_oldest' | 'prune_least_important'
  priority: number
}

export interface PartitionedContext {
  zones: Map<PriorityZone, Message[]>
  totalTokens: number
  zoneTokens: Map<PriorityZone, number>
  canFitInWindow: boolean
}

export interface PartitionOptions {
  contextWindow: number
  zones?: ZoneConfig[]
  recentCount?: number
}

const DEFAULT_ZONES: ZoneConfig[] = [
  { name: 'recent', maxTokens: 50000, retentionPolicy: 'keep_all', priority: 4 },
  { name: 'important', maxTokens: 30000, retentionPolicy: 'prune_least_important', priority: 3 },
  { name: 'background', maxTokens: 10000, retentionPolicy: 'prune_oldest', priority: 2 },
  { name: 'system', maxTokens: 8000, retentionPolicy: 'keep_all', priority: 1 },
]

function getMessageText(message: Message): string {
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: unknown) => {
      if (typeof block !== 'object' || block === null) return ''
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') return b.text
      if (b.type === 'tool_result') {
        const inner = b.content
        if (typeof inner === 'string') return inner
        if (Array.isArray(inner)) {
          return inner
            .map((i: unknown) => (typeof i === 'object' && i !== null && (i as Record<string, unknown>).type === 'text' ? (i as Record<string, unknown>).text : ''))
            .join('')
        }
      }
      return ''
    })
    .join(' ')
}

function hasToolBlocks(message: Message): boolean {
  const content = message.message?.content
  if (!Array.isArray(content)) return false
  return content.some(
    (block: unknown) =>
      typeof block === 'object' &&
      block !== null &&
      ((block as Record<string, unknown>).type === 'tool_use' ||
        (block as Record<string, unknown>).type === 'tool_result'),
  )
}

function classifyMessage(message: Message, isRecent: boolean): PriorityZone {
  if (message.message?.role === 'system') return 'system'
  if (hasToolBlocks(message)) return 'important'
  const text = getMessageText(message).toLowerCase()
  if (text.includes('error') || text.includes('fail') || text.includes('exception')) return 'important'
  if (isRecent) return 'recent'
  return 'background'
}

export function partitionContext(
  messages: Message[],
  options: PartitionOptions,
): PartitionedContext {
  const zonesConfig = options.zones ?? DEFAULT_ZONES
  const zones = new Map<PriorityZone, Message[]>()
  const zoneTokens = new Map<PriorityZone, number>()

  for (const zone of zonesConfig) {
    zones.set(zone.name, [])
    zoneTokens.set(zone.name, 0)
  }

  const recentCount = options.recentCount ?? 5
  const recentMessages = messages.slice(-recentCount)
  const olderMessages = messages.slice(0, -recentCount)

  for (const msg of recentMessages) {
    const zone = classifyMessage(msg, true)
    zones.get(zone)!.push(msg)
    const t = roughTokenCountEstimation(getMessageText(msg))
    zoneTokens.set(zone, (zoneTokens.get(zone) ?? 0) + t)
  }

  for (const msg of olderMessages) {
    const zone = classifyMessage(msg, false)
    const maxForZone = zonesConfig.find(z => z.name === zone)?.maxTokens ?? Infinity
    const current = zoneTokens.get(zone) ?? 0
    const t = roughTokenCountEstimation(getMessageText(msg))
    if (current + t <= maxForZone) {
      zones.get(zone)!.push(msg)
      zoneTokens.set(zone, current + t)
    }
  }

  const totalTokens = Array.from(zoneTokens.values()).reduce((a, b) => a + b, 0)
  const canFitInWindow = totalTokens <= options.contextWindow

  return { zones, totalTokens, zoneTokens, canFitInWindow }
}

export function getZoneMessages(context: PartitionedContext, zone: PriorityZone): Message[] {
  return context.zones.get(zone) ?? []
}

export function getAllMessages(context: PartitionedContext): Message[] {
  const result: Message[] = []
  for (const [zoneName, zoneMessages] of context.zones) {
    if (zoneName !== 'system') result.push(...zoneMessages)
  }
  return result
}

export function getAvailableSpace(context: PartitionedContext, contextWindow: number): number {
  return Math.max(0, contextWindow - context.totalTokens)
}
