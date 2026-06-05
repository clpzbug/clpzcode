/**
 * Multi-Turn Context Tracking - Production Grade
 * 
 * Tracks context across multiple tool use cycles.
 * Preserves state between tool invocations.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export interface TurnContext {
  turnId: string
  startTime: number
  messages: Message[]
  toolCalls: Array<{
    id: string
    name: string
    input: Record<string, unknown>
    timestamp: number
  }>
  state: Map<string, unknown>
  tokens: number
  /** Set once the per-turn budget evicted oldest entries (memory bound hit). */
  truncated?: boolean
}

// Hard cap on a single turn's toolCalls array so a tool-heavy turn (a long pentest
// run firing thousands of tool calls without a turn boundary) can't grow it
// unbounded — the known module-level-unbounded OOM class.
const MAX_TOOL_CALLS_PER_TURN = 1000

function contentTokens(message: Message): number {
  const content =
    typeof message.message.content === 'string'
      ? message.message.content
      : JSON.stringify(message.message.content)
  return roughTokenCountEstimation(content)
}

// Bound a turn's in-memory footprint: evict oldest messages (FIFO) until under the
// per-turn token budget, and cap the toolCalls array. This is an AUXILIARY tracker
// (not the conversation source of truth), so dropping old entries frees memory
// without losing real data. maxTokensPerTurn was defined but never enforced.
function enforceTurnBudget(turn: TurnContext): void {
  const cap = activeOptions.maxTokensPerTurn
  if (cap > 0) {
    while (turn.tokens > cap && turn.messages.length > 1) {
      const dropped = turn.messages.shift()!
      turn.tokens -= contentTokens(dropped)
      turn.truncated = true
    }
    if (turn.tokens < 0) turn.tokens = 0
  }
  if (turn.toolCalls.length > MAX_TOOL_CALLS_PER_TURN) {
    turn.toolCalls.splice(0, turn.toolCalls.length - MAX_TOOL_CALLS_PER_TURN)
    turn.truncated = true
  }
}

export interface MultiTurnOptions {
  maxTurns?: number
  maxTokensPerTurn?: number
  preserveState?: boolean
}

const DEFAULT_OPTIONS: Required<MultiTurnOptions> = {
  maxTurns: 10,
  maxTokensPerTurn: 50000,
  preserveState: true,
}

let turnHistory: TurnContext[] = []
let currentTurn: TurnContext | null = null
let turnCounter = 0
let activeOptions: Required<MultiTurnOptions> = { ...DEFAULT_OPTIONS }

export function startNewTurn(): TurnContext {
  const turn: TurnContext = {
    turnId: `turn_${++turnCounter}_${Date.now()}`,
    startTime: Date.now(),
    messages: [],
    toolCalls: [],
    state: new Map(),
    tokens: 0,
  }

  if (turnHistory.length >= activeOptions.maxTurns) {
    turnHistory = turnHistory.slice(-activeOptions.maxTurns + 1)
  }

  currentTurn = turn
  turnHistory.push(turn)

  return turn
}

export function getCurrentTurn(): TurnContext | null {
  return currentTurn
}

export function addMessageToTurn(message: Message): void {
  const turn = currentTurn || startNewTurn()
  turn.messages.push(message)
  turn.tokens += contentTokens(message)
  enforceTurnBudget(turn)
}

export function addToolCallToTurn(call: TurnContext['toolCalls'][0]): void {
  const turn = currentTurn || startNewTurn()
  turn.toolCalls.push(call)
  enforceTurnBudget(turn)
}

export function setTurnState(key: string, value: unknown): void {
  const turn = currentTurn || startNewTurn()
  turn.state.set(key, value)
}

export function getTurnState<T>(key: string): T | undefined {
  return currentTurn?.state.get(key) as T
}

export function getTurnHistory(): TurnContext[] {
  return turnHistory
}

export function getRecentTurns(n: number): TurnContext[] {
  return turnHistory.slice(-n)
}

export function getMultiTurnStats() {
  return {
    totalTurns: turnHistory.length,
    totalTokens: turnHistory.reduce((acc, t) => acc + t.tokens, 0),
    avgTokensPerTurn: turnHistory.length > 0 
      ? Math.round(turnHistory.reduce((acc, t) => acc + t.tokens, 0) / turnHistory.length) 
      : 0,
  }
}

export function clearTurnHistory(): void {
  turnHistory = []
  currentTurn = null
}

export function resetMultiTurnState(): void {
  clearTurnHistory()
  turnCounter = 0
}

export function createMultiTurnTracker(options: MultiTurnOptions = {}) {
  activeOptions = { ...DEFAULT_OPTIONS, ...options }
  return {
    startTurn: startNewTurn,
    getCurrentTurn,
    addMessage: addMessageToTurn,
    addToolCall: addToolCallToTurn,
    setState: (k: string, v: unknown) => setTurnState(k, v),
    getState: <T>(k: string) => getTurnState<T>(k),
    getHistory: getTurnHistory,
    getRecent: (n: number) => getRecentTurns(n),
    getStats: getMultiTurnStats,
    reset: resetMultiTurnState,
  }
}
