import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import type Anthropic from '@anthropic-ai/sdk'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'

// Regression test for the self-heal of the "cache_control.scope global" 400.
// firstParty accounts WITHOUT the prompt_caching_scope entitlement got that 400
// on every Claude call (no model could connect). The fix flips a bounded session
// kill-switch so subsequent requests omit scope:'global'. These tests prove:
//  1. healthyAccountUnchanged — flag unset → gate ON → scope still emitted.
//  2. selfHealWorks (unit) — disableGlobalCacheScopeForSession() flips the gate
//     OFF and getCacheControl stops emitting scope.
//  3. selfHealWorks (integration) — withRetry's catch invokes the disable on a
//     cache_control 400 and retries; an unrelated 400 does NOT.

const CACHE_400_MESSAGE = 'cache_control.scope: global is not supported'

// Build REAL APIError instances — withRetry gates on `error instanceof APIError`,
// so a plain object cast would never reach shouldRetry(). APIError.makeMessage
// derives error.message from the response body's `.message`, so put the text there.
function makeCacheScope400(): APIError {
  return new APIError(
    400,
    { message: CACHE_400_MESSAGE },
    undefined,
    new Headers(),
  )
}

// A plain 400 that does NOT mention cache_control — must NOT trigger the heal.
function makeUnrelated400(): APIError {
  return new APIError(
    400,
    { message: 'messages: at least one message is required' },
    undefined,
    new Headers(),
  )
}

const dummyClient = {} as unknown as Anthropic
const retryOptions = {
  model: 'claude-opus-4-1',
  thinkingConfig: { type: 'disabled' as const },
}

beforeEach(async () => {
  await acquireSharedMutationLock('cacheControlScopeSelfHeal.test.ts')
})

afterEach(() => {
  mock.restore()
  releaseSharedMutationLock()
})

function mockFirstPartyProvider() {
  mock.module('src/utils/model/providers.js', () => ({
    getAPIProvider: () => 'firstParty',
    getAPIProviderForStatsig: () => 'firstParty',
    isFirstPartyAnthropicBaseUrl: () => true,
    isGithubNativeAnthropicMode: () => false,
    usesAnthropicAccountFlow: () => false,
  }))
  // Ensure no env var disables experimental betas, so the gate depends only on
  // the kill-switch flag (the thing under test).
  delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
}

// Pure-gate tests use an ISOLATED (cache-busted) betas instance so each gets a
// fresh set-once boolean — flipping one never leaks into another test.
async function loadIsolatedBetasAndClaude() {
  mock.restore()
  mockFirstPartyProvider()
  const bust = `${Date.now()}-${Math.random()}`
  const betas = await import(`../../utils/betas.js?ts=${bust}`)
  const claude = await import(`./claude.js?ts=${bust}`)
  return { betas, claude }
}

// Integration tests drive the real withRetry. withRetry's static import of betas
// resolves to the BASE betas instance; we intercept that import with a spy that
// calls through to the real disable, so we can assert it WAS / WAS NOT invoked
// (order-independent) AND that the real flag flips end-to-end. sleep is stubbed
// instant so retry backoff doesn't slow the test.
async function loadWithRetryWithSpy() {
  mock.restore()
  mockFirstPartyProvider()
  mock.module('src/utils/sleep.js', () => ({
    sleep: async () => {},
    withTimeout: async <T>(p: Promise<T>) => p,
  }))
  const baseBetas = await import('../../utils/betas.js')
  // Capture the REAL function before mocking — the spy calls through to it. (If
  // the spy referenced baseBetas.disableGlobalCacheScopeForSession after the
  // mock, it would resolve to itself and recurse infinitely.)
  const realDisable = baseBetas.disableGlobalCacheScopeForSession
  const disableSpy = mock(() => realDisable())
  mock.module('../../utils/betas.js', () => ({
    ...baseBetas,
    disableGlobalCacheScopeForSession: disableSpy,
  }))
  const withRetryMod = await import(
    `./withRetry.js?ts=${Date.now()}-${Math.random()}`
  )
  return { withRetryMod, disableSpy }
}

// Drain the withRetry async generator to its return value.
async function drain<T>(gen: AsyncGenerator<unknown, T>): Promise<T> {
  while (true) {
    const next = await gen.next()
    if (next.done) return next.value
  }
}

describe('cache_control.scope global self-heal', () => {
  test('healthyAccountUnchanged: flag unset → gate true and scope emitted', async () => {
    const { betas, claude } = await loadIsolatedBetasAndClaude()
    // Entitled-account behavior: gate ON, getCacheControl still emits scope.
    expect(betas.shouldUseGlobalCacheScope()).toBe(true)
    expect(claude.getCacheControl({ scope: 'global' })).toEqual({
      type: 'ephemeral',
      scope: 'global',
    })
  })

  test('selfHealWorks (unit): disable flips gate off and stops scope emission', async () => {
    const { betas, claude } = await loadIsolatedBetasAndClaude()
    // Precondition: gate ON before heal.
    expect(betas.shouldUseGlobalCacheScope()).toBe(true)

    betas.disableGlobalCacheScopeForSession()

    // After heal: gate OFF, so upstream callers stop passing scope:'global' and
    // getCacheControl() (no scope) is clean. (Mutation-killer: if the guard in
    // shouldUseGlobalCacheScope is removed, this stays true and the test fails.)
    expect(betas.shouldUseGlobalCacheScope()).toBe(false)
    expect(claude.getCacheControl()).toEqual({ type: 'ephemeral' })
  })

  test('selfHealWorks (integration): withRetry invokes the disable on a cache 400 and retries', async () => {
    const { withRetryMod, disableSpy } = await loadWithRetryWithSpy()

    let attempts = 0
    const operation = async () => {
      attempts++
      if (attempts === 1) throw makeCacheScope400()
      return 'ok'
    }

    const result = await drain(
      withRetryMod.withRetry(async () => dummyClient, operation, retryOptions),
    )

    expect(result).toBe('ok')
    expect(attempts).toBe(2) // retried exactly once after the heal
    // The catch in shouldRetry must have flipped the bounded kill-switch.
    // Mutation-killer: delete disableGlobalCacheScopeForSession() in shouldRetry
    // and the spy count drops to 0; remove the whole isCacheControlScope400 block
    // and the request is treated as a non-retryable 400 (attempts stays 1).
    expect(disableSpy).toHaveBeenCalledTimes(1)
  })

  test('does NOT heal on an unrelated 400 (no false positives)', async () => {
    const { withRetryMod, disableSpy } = await loadWithRetryWithSpy()

    let attempts = 0
    const operation = async () => {
      attempts++
      throw makeUnrelated400()
    }

    // Unrelated 400 is not retryable → withRetry throws CannotRetryError.
    await expect(
      drain(
        withRetryMod.withRetry(async () => dummyClient, operation, retryOptions),
      ),
    ).rejects.toBeInstanceOf(withRetryMod.CannotRetryError)

    expect(attempts).toBe(1) // no retry
    // An unrelated 400 must never disable caching (defensive string match guard).
    expect(disableSpy).not.toHaveBeenCalled()
  })
})
