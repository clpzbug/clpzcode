import { describe, expect, test } from 'bun:test'
import { withFileMutex, __mutexQueueSize } from './fileMutationQueue.js'

describe('withFileMutex bounding', () => {
  test('drops entry after a single chain drains', async () => {
    await withFileMutex('/a', async () => {})
    await Promise.resolve() // let the tail cleanup microtask run
    expect(__mutexQueueSize()).toBe(0)
  })

  test('serializes concurrent calls then drops the entry', async () => {
    const order: number[] = []
    const p1 = withFileMutex('/b', async () => { order.push(1) })
    const p2 = withFileMutex('/b', async () => { order.push(2) })
    await Promise.all([p1, p2])
    await Promise.resolve()
    expect(order).toEqual([1, 2])
    expect(__mutexQueueSize()).toBe(0)
  })

  test('does not delete an entry a later caller extended', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const p1 = withFileMutex('/c', async () => { await gate })
    const p2 = withFileMutex('/c', async () => {}) // extends the chain
    expect(__mutexQueueSize()).toBe(1)
    release()
    await Promise.all([p1, p2])
    await Promise.resolve()
    expect(__mutexQueueSize()).toBe(0) // only the final tail cleans up
  })

  test('errors do not leak the entry', async () => {
    await expect(withFileMutex('/d', async () => { throw new Error('x') })).rejects.toThrow('x')
    await Promise.resolve()
    expect(__mutexQueueSize()).toBe(0)
  })
})
