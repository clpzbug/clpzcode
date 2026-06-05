// src/utils/signal.test.ts
import { describe, expect, test } from 'bun:test'
import { createSignal } from './signal.js'

describe('createSignal', () => {
  test('emit calls every subscribed listener with the args', () => {
    const s = createSignal<[number]>()
    const seen: number[] = []
    s.subscribe(n => seen.push(n))
    s.subscribe(n => seen.push(n * 10))
    s.emit(3)
    expect(seen).toEqual([3, 30])
  })

  test('a throwing listener does not abort fan-out to the others', () => {
    const s = createSignal<[number]>()
    const seen: number[] = []
    s.subscribe(() => {
      throw new Error('boom')
    })
    s.subscribe(n => seen.push(n))
    s.subscribe(n => seen.push(n * 2))
    s.emit(5)
    expect(seen).toEqual([5, 10]) // both ran despite the first listener throwing
  })

  test('unsubscribe removes only that listener', () => {
    const s = createSignal()
    let a = 0
    let b = 0
    const off = s.subscribe(() => a++)
    s.subscribe(() => b++)
    off()
    s.emit()
    expect(a).toBe(0)
    expect(b).toBe(1)
  })
})
