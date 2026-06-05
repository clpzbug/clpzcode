// Regression for audit2 #12: swarm permission callbacks (sandbox + permission)
// leaked forever — and left the worker's awaiting Promise hung — when the
// leader never responded. Each registration now arms an unref'd safety timer
// that denies + cleans up on expiry, cleared when a real response arrives.
import { afterEach, describe, expect, jest, test } from 'bun:test'
import {
  clearAllPendingCallbacks,
  hasSandboxPermissionCallback,
  processSandboxPermissionResponse,
  registerSandboxPermissionCallback,
} from './useSwarmPermissionPoller.js'

const FIVE_MIN = 5 * 60_000

afterEach(() => {
  jest.useRealTimers()
  clearAllPendingCallbacks()
})

describe('sandbox permission callback timeout (audit2 #12)', () => {
  test('denies and unregisters when the leader never responds', () => {
    jest.useFakeTimers()
    let resolved: boolean | undefined
    registerSandboxPermissionCallback({
      requestId: 'r1',
      host: 'example.com',
      resolve: allow => {
        resolved = allow
      },
    })
    expect(hasSandboxPermissionCallback('r1')).toBe(true)
    expect(resolved).toBeUndefined() // not resolved early

    jest.advanceTimersByTime(FIVE_MIN + 1)
    expect(resolved).toBe(false) // timed out → deny
    expect(hasSandboxPermissionCallback('r1')).toBe(false) // cleaned up
  })

  test('a real response clears the timer (no late spurious deny)', () => {
    jest.useFakeTimers()
    const calls: boolean[] = []
    registerSandboxPermissionCallback({
      requestId: 'r2',
      host: 'example.com',
      resolve: allow => calls.push(allow),
    })
    const handled = processSandboxPermissionResponse({ requestId: 'r2', host: 'example.com', allow: true })
    expect(handled).toBe(true)
    expect(calls).toEqual([true])
    expect(hasSandboxPermissionCallback('r2')).toBe(false)

    // The timer must NOT fire a second (false) resolve after the response.
    jest.advanceTimersByTime(FIVE_MIN + 1)
    expect(calls).toEqual([true])
  })

  test('clearAllPendingCallbacks cancels pending timers (no deferred deny)', () => {
    jest.useFakeTimers()
    const calls: boolean[] = []
    registerSandboxPermissionCallback({
      requestId: 'r3',
      host: 'example.com',
      resolve: allow => calls.push(allow),
    })
    clearAllPendingCallbacks()
    expect(hasSandboxPermissionCallback('r3')).toBe(false)
    jest.advanceTimersByTime(FIVE_MIN + 1)
    expect(calls).toEqual([]) // timer was cleared, never fired
  })
})
