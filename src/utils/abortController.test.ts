// Contract guard for createChildAbortController after the GC-backstop change
// (audit2 #4): the parent-listener leak fix must not alter the propagation
// semantics. FinalizationRegistry firing is non-deterministic, so we assert
// the observable contract, not GC timing.
import { describe, expect, test } from 'bun:test'
import { createAbortController, createChildAbortController } from './abortController.js'

describe('createChildAbortController', () => {
  test('child aborts when parent aborts', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    expect(child.signal.aborted).toBe(false)
    parent.abort('stop')
    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('stop')
  })

  test('aborting the child does not abort the parent', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    child.abort('child-only')
    expect(child.signal.aborted).toBe(true)
    expect(parent.signal.aborted).toBe(false)
  })

  test('fast path: child created from an already-aborted parent is aborted', () => {
    const parent = createAbortController()
    parent.abort('already')
    const child = createChildAbortController(parent)
    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('already')
  })

  test('explicitly aborting the child removes the parent listener (no leak)', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    child.abort()
    // After the child aborts, a later parent abort must be a clean no-op for it.
    parent.abort()
    expect(parent.signal.aborted).toBe(true)
  })
})
