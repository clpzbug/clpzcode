import { describe, expect, test } from 'bun:test'
import { all } from './generators.js'

// STREAM-2 regression: all() must close in-flight children when the consumer
// stops early (break / .return()), not only on the rejection path — otherwise
// child finally blocks (tool / in-progress-ID release) never run on abort.
describe('all() early-return cleanup', () => {
  test('closes still-in-flight children when the consumer breaks early', async () => {
    const cleaned: number[] = []
    const child = (id: number, count: number) =>
      (async function* () {
        try {
          for (let i = 0; i < count; i++) yield id
        } finally {
          cleaned.push(id)
        }
      })()

    // Two long children, concurrency 2 so both are in-flight; break after 1 value.
    const merged = all([child(1, 100), child(2, 100)], 2)
    for await (const _ of merged) {
      break // abandons the merged generator → triggers all().return()
    }

    expect(cleaned.sort()).toEqual([1, 2])
  })

  test('still cleans up on the rejection path', async () => {
    const cleaned: number[] = []
    const ok = (async function* () {
      try {
        for (let i = 0; i < 100; i++) yield 1
      } finally {
        cleaned.push(1)
      }
    })()
    const boom = (async function* () {
      yield 2
      throw new Error('boom')
    })()

    await expect(
      (async () => {
        for await (const _ of all([ok, boom], 2)) void _
      })(),
    ).rejects.toThrow('boom')
    expect(cleaned).toContain(1)
  })
})
