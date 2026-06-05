// Unit tests for parseRetryAfterMs (audit2 #11): GitHub 429 backoff must honor
// the server Retry-After header, parsing both the delta-seconds and HTTP-date
// forms and rejecting garbage.
import { describe, expect, test } from 'bun:test'
import { parseRetryAfterMs } from './openaiShim.js'

function resWith(retryAfter?: string): Response {
  const headers = new Headers()
  if (retryAfter !== undefined) headers.set('retry-after', retryAfter)
  return new Response(null, { headers })
}

describe('parseRetryAfterMs', () => {
  test('delta-seconds → milliseconds', () => {
    expect(parseRetryAfterMs(resWith('120'))).toBe(120_000)
    expect(parseRetryAfterMs(resWith('0'))).toBe(0)
  })

  test('absent header → null', () => {
    expect(parseRetryAfterMs(resWith())).toBeNull()
  })

  test('unparseable value → null', () => {
    expect(parseRetryAfterMs(resWith('soon'))).toBeNull()
  })

  test('HTTP-date in the past → clamped to 0 (never negative)', () => {
    expect(parseRetryAfterMs(resWith('Wed, 21 Oct 2015 07:28:00 GMT'))).toBe(0)
  })

  test('HTTP-date in the future → a positive delay', () => {
    // Far-future date: delta must be positive (exact value is time-relative).
    const ms = parseRetryAfterMs(resWith('Fri, 31 Dec 2999 23:59:59 GMT'))
    expect(ms).not.toBeNull()
    expect(ms!).toBeGreaterThan(0)
  })
})
