import { afterEach, describe, expect, it, beforeEach } from 'bun:test'
import {
  startNewTurn,
  getCurrentTurn,
  addMessageToTurn,
  addToolCallToTurn,
  setTurnState,
  getTurnState,
  getTurnHistory,
  getRecentTurns,
  getMultiTurnStats,
  resetMultiTurnState,
  createMultiTurnTracker,
} from './multiTurnContext.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

function createMessage(role: string, content: string): any {
  return {
    message: { role, content, id: 'test', type: 'message', created_at: Date.now() },
    sender: role,
  }
}

describe('multiTurnContext', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('utils/multiTurnContext.test.ts')
    createMultiTurnTracker()
    resetMultiTurnState()
  })

  afterEach(() => {
    try {
      createMultiTurnTracker()
      resetMultiTurnState()
    } finally {
      releaseSharedMutationLock()
    }
  })

  describe('startNewTurn', () => {
    it('creates a new turn', () => {
      const turn = startNewTurn()
      expect(turn.turnId).toBeDefined()
      expect(turn.startTime).toBeDefined()
      expect(turn.messages).toEqual([])
    })

    it('tracks turn count', () => {
      startNewTurn()
      const turn2 = startNewTurn()
      expect(turn2.turnId).toContain('turn_2')
    })
  })

  describe('addMessageToTurn', () => {
    it('adds message to current turn', () => {
      startNewTurn()
      addMessageToTurn(createMessage('user', 'Hello'))
      expect(getCurrentTurn()?.messages.length).toBe(1)
    })

    it('creates turn if none exists', () => {
      addMessageToTurn(createMessage('user', 'Hello'))
      expect(getCurrentTurn()).toBeDefined()
      expect(getCurrentTurn()?.messages.length).toBe(1)
    })
  })

  describe('addToolCallToTurn', () => {
    it('adds tool call to turn', () => {
      startNewTurn()
      addToolCallToTurn({
        id: 'call_1',
        name: 'test_tool',
        input: {},
        timestamp: Date.now(),
      })
      expect(getCurrentTurn()?.toolCalls.length).toBe(1)
    })
  })

  describe('state management', () => {
    it('sets and gets turn state', () => {
      startNewTurn()
      setTurnState('key', 'value')
      expect(getTurnState('key') as any).toBe('value')
    })

    it('returns undefined for unknown keys', () => {
      startNewTurn()
      expect(getTurnState('unknown')).toBeUndefined()
    })
  })

  describe('getTurnHistory', () => {
    it('returns turn history', () => {
      startNewTurn()
      startNewTurn()
      expect(getTurnHistory().length).toBe(2)
    })
  })

  describe('getRecentTurns', () => {
    it('returns recent turns', () => {
      startNewTurn()
      startNewTurn()
      startNewTurn()
      expect(getRecentTurns(2).length).toBe(2)
    })
  })

  describe('getMultiTurnStats', () => {
    it('returns statistics', () => {
      startNewTurn()
      addMessageToTurn(createMessage('user', 'Hello'))
      const stats = getMultiTurnStats()
      expect(stats.totalTurns).toBe(1)
      expect(stats.totalTokens).toBeGreaterThan(0)
    })
  })

  describe('createMultiTurnTracker', () => {
    it('creates tracker with all methods', () => {
      const tracker = createMultiTurnTracker()
      expect(tracker.startTurn).toBeDefined()
      expect(tracker.addMessage).toBeDefined()
      expect(tracker.getStats).toBeDefined()
    })

    it('respects the maxTurns option', () => {
      // Create a tracker with a very small maxTurns
      createMultiTurnTracker({ maxTurns: 2 })
      
      startNewTurn() // turn 1
      startNewTurn() // turn 2
      startNewTurn() // turn 3 - should drop turn 1
      
      const history = getTurnHistory()
      expect(history.length).toBe(2)
      // The first remaining turn should be the 2nd one created
      expect(history[0].turnId).toContain('turn_2')
    })
  })

  describe('per-turn budget enforcement', () => {
    it('evicts oldest messages and flags truncated when over maxTokensPerTurn', () => {
      createMultiTurnTracker({ maxTokensPerTurn: 50 })
      const turn = startNewTurn()
      // Each ~long message far exceeds 50 tokens; the budget keeps only the newest.
      for (let i = 0; i < 5; i++) {
        addMessageToTurn(createMessage('user', 'x'.repeat(400) + ` #${i}`))
      }
      expect(turn.messages.length).toBeLessThanOrEqual(1)
      expect(turn.truncated).toBe(true)
      expect(turn.tokens).toBeGreaterThanOrEqual(0)
    })

    it('caps the toolCalls array (no unbounded growth in a long turn)', () => {
      createMultiTurnTracker({ maxTokensPerTurn: 1_000_000 })
      const turn = startNewTurn()
      for (let i = 0; i < 1100; i++) {
        addToolCallToTurn({ id: `t${i}`, name: 'x', input: {}, timestamp: 0 })
      }
      expect(turn.toolCalls.length).toBeLessThanOrEqual(1000)
      expect(turn.truncated).toBe(true)
    })
  })
})
