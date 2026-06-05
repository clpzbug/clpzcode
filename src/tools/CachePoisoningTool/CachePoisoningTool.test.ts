import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { __test } from './CachePoisoningTool.js'

const { detectCacheIndicators } = __test

const ACTIONS = ['poison_headers', 'cache_deception', 'key_audit', 'dos'] as const

const schema = z.strictObject({
  url: z.string(),
  action: z.enum(ACTIONS),
  headers: z.record(z.string(), z.string()).optional(),
  poison_value: z.string().default('attacker.example.com'),
  path_suffix: z.string().default('.css'),
  timeout_secs: z.number().int().min(5).max(120).default(30),
})

describe('CachePoisoningTool schema', () => {
  test('accepts poison_headers action', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'poison_headers' })
    expect(r.success).toBe(true)
  })

  test('accepts cache_deception action', () => {
    const r = schema.safeParse({ url: 'https://example.com/account/profile', action: 'cache_deception' })
    expect(r.success).toBe(true)
  })

  test('accepts key_audit action', () => {
    const r = schema.safeParse({ url: 'https://example.com/page', action: 'key_audit' })
    expect(r.success).toBe(true)
  })

  test('accepts dos action', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'dos' })
    expect(r.success).toBe(true)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ action: 'poison_headers' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'inject' })
    expect(r.success).toBe(false)
  })

  test('defaults poison_value', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'poison_headers' })
    if (r.success) expect(r.data.poison_value).toBe('attacker.example.com')
  })

  test('defaults path_suffix to .css', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'cache_deception' })
    if (r.success) expect(r.data.path_suffix).toBe('.css')
  })

  test('accepts custom poison_value', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'poison_headers', poison_value: 'evil.com' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.poison_value).toBe('evil.com')
  })

  test('accepts session cookie in headers', () => {
    const r = schema.safeParse({
      url: 'https://example.com/account',
      action: 'cache_deception',
      headers: { Cookie: 'session=abc123' },
    })
    expect(r.success).toBe(true)
  })
})

// =============================================================================
// detectCacheIndicators — cache-hit header/body detection
// =============================================================================

describe('detectCacheIndicators', () => {
  test('detects X-Cache: HIT', () => {
    expect(detectCacheIndicators('HTTP/1.1 200 OK\r\nX-Cache: HIT', '')).toBe(true)
  })

  test('detects CF-Cache-Status: HIT (Cloudflare)', () => {
    expect(detectCacheIndicators('CF-Cache-Status: HIT', '')).toBe(true)
  })

  test('detects positive Age header (Age > 0 = cached)', () => {
    expect(detectCacheIndicators('HTTP/1.1 200 OK\r\nAge: 3600', '')).toBe(true)
  })

  test('does NOT detect Age: 0 as cached (Age=0 = freshly fetched, not cached)', () => {
    // Age: 0 means the response was just fetched from origin, NOT served from cache.
    // The old code had Age: present → cached which was a false positive.
    expect(detectCacheIndicators('HTTP/1.1 200 OK\r\nAge: 0', '')).toBe(false)
  })

  test('detects Age: 1 as cached (any positive age = served from cache)', () => {
    expect(detectCacheIndicators('HTTP/1.1 200 OK\r\nAge: 1', '')).toBe(true)
  })

  test('detects X-Varnish header', () => {
    expect(detectCacheIndicators('X-Varnish: 12345', '')).toBe(true)
  })

  test('is case-insensitive', () => {
    expect(detectCacheIndicators('x-cache: hit', '')).toBe(true)
  })

  test('returns false for non-cached response', () => {
    expect(detectCacheIndicators('HTTP/1.1 200 OK\r\nContent-Type: text/html', 'hello world')).toBe(false)
  })

  test('returns false for empty input', () => {
    expect(detectCacheIndicators('', '')).toBe(false)
  })

  test('detects cache indicator in body', () => {
    expect(detectCacheIndicators('', 'served from cached store')).toBe(true)
  })
})

describe('detectCacheIndicators — edge cases', () => {
  test('does not false-positive on word "uncached" (word-boundary check)', () => {
    // The old "cached" substring check would match "uncached"
    // The new /\bcached\b/ check requires word boundaries
    const result = detectCacheIndicators('', 'This content is uncached')
    // "uncached" should NOT match the cached word-boundary pattern
    expect(result).toBe(false)
  })

  test('detects exact word "cached" in body', () => {
    expect(detectCacheIndicators('', 'Content is cached')).toBe(true)
  })

  test('detects CF-Cache-Status: HIT', () => {
    expect(detectCacheIndicators('CF-Cache-Status: HIT', '')).toBe(true)
  })

  test('does NOT detect CF-Cache-Status: MISS', () => {
    expect(detectCacheIndicators('CF-Cache-Status: MISS', '')).toBe(false)
  })
})

// =============================================================================
// CachePoisoningTool escalation tests
// =============================================================================

describe('CachePoisoningTool — escalation scenarios', () => {
  test('poison_headers is the first action to test (per prompt)', () => {
    const r = schema.safeParse({ url: 'https://target.com/', action: 'poison_headers' })
    expect(r.success).toBe(true)
  })

  test('cache_deception for authenticated content exposure', () => {
    const r = schema.safeParse({
      url: 'https://target.com/account/profile',
      action: 'cache_deception',
      path_suffix: '.css',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.path_suffix).toBe('.css')
  })

  test('key_audit to find unkeyed parameters for poisoning', () => {
    const r = schema.safeParse({ url: 'https://target.com/page', action: 'key_audit' })
    expect(r.success).toBe(true)
  })

  test('custom poison_value for JavaScript XSS via cached response', () => {
    // When reflection is confirmed, next step is to inject JS payload
    const r = schema.safeParse({
      url: 'https://target.com/',
      action: 'poison_headers',
      poison_value: 'evil.com"><script>alert(document.domain)</script>',
    })
    expect(r.success).toBe(true)
  })
})
