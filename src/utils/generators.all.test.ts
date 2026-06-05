// Regression for two audit-confirmed bugs in all():
//  #9 — a legitimate `undefined` yield was silently dropped by an
//       `if (value !== undefined)` guard.
//  #6 — when one generator's next() rejected, the sibling generators were
//       abandoned: their finally blocks (tool/in-progress-ID cleanup) never ran.
import { describe, expect, test } from 'bun:test'
import { all, toArray } from './generators.js'

describe('all()', () => {
  test('yields a legitimate undefined value (no longer dropped)', async () => {
    async function* g(): AsyncGenerator<number | undefined, void> {
      yield 1
      yield undefined
      yield 3
    }
    const out = await toArray(all([g()]))
    expect(out).toEqual([1, undefined, 3])
  })

  test('runs sibling finally blocks when one generator throws', async () => {
    let siblingCleanedUp = false
    async function* boom(): AsyncGenerator<number, void> {
      yield 1
      throw new Error('boom')
    }
    async function* sibling(): AsyncGenerator<number, void> {
      try {
        yield 10
        // Suspends here; the consumer stops pulling once boom() rejects.
        yield 11
      } finally {
        siblingCleanedUp = true
      }
    }
    let caught: unknown
    try {
      await toArray(all([boom(), sibling()]))
    } catch (e) {
      caught = e
    }
    expect((caught as Error)?.message).toBe('boom')
    // The fix calls .return() on the abandoned sibling; give microtasks a tick.
    await new Promise(r => setTimeout(r, 10))
    expect(siblingCleanedUp).toBe(true)
  })
})
