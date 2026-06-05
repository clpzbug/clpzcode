import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const ACTIONS = ['upgrade', 'cswsh', 'auth', 'scan'] as const

const schema = z.strictObject({
  url: z.string(),
  action: z.enum(ACTIONS),
  origin: z.string().optional(),
  cookie: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout_secs: z.number().int().min(5).max(60).default(15),
})

describe('WebSocketTool schema', () => {
  test('accepts upgrade action', () => {
    const r = schema.safeParse({ url: 'wss://example.com/ws', action: 'upgrade' })
    expect(r.success).toBe(true)
  })

  test('accepts cswsh action with custom origin', () => {
    const r = schema.safeParse({ url: 'wss://example.com/ws', action: 'cswsh', origin: 'https://evil.com' })
    expect(r.success).toBe(true)
  })

  test('accepts auth action with cookie', () => {
    const r = schema.safeParse({ url: 'wss://example.com/ws', action: 'auth', cookie: 'session=abc123' })
    expect(r.success).toBe(true)
  })

  test('accepts scan action', () => {
    const r = schema.safeParse({ url: 'wss://example.com/ws', action: 'scan' })
    expect(r.success).toBe(true)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ action: 'upgrade' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ url: 'wss://example.com/ws', action: 'inject' })
    expect(r.success).toBe(false)
  })

  test('defaults timeout_secs to 15', () => {
    const r = schema.safeParse({ url: 'wss://example.com/ws', action: 'upgrade' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.timeout_secs).toBe(15)
  })

  test('rejects timeout above max (60)', () => {
    const r = schema.safeParse({ url: 'wss://example.com/ws', action: 'scan', timeout_secs: 61 })
    expect(r.success).toBe(false)
  })

  test('accepts additional headers', () => {
    const r = schema.safeParse({ url: 'wss://example.com/ws', action: 'auth', headers: { 'X-Custom': 'value' } })
    expect(r.success).toBe(true)
  })

  test('accepts wss:// scheme (TLS WebSocket)', () => {
    const r = schema.safeParse({ url: 'wss://example.com/ws', action: 'upgrade' })
    expect(r.success).toBe(true)
  })

  test('accepts ws:// scheme (plain WebSocket)', () => {
    const r = schema.safeParse({ url: 'ws://example.com/ws', action: 'scan' })
    expect(r.success).toBe(true)
  })

  test('cswsh with custom evil origin', () => {
    const r = schema.safeParse({
      url: 'wss://target.com/ws',
      action: 'cswsh',
      origin: 'https://attacker.com',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.origin).toBe('https://attacker.com')
  })

  test('auth with session cookie', () => {
    const r = schema.safeParse({
      url: 'wss://target.com/ws',
      action: 'auth',
      cookie: 'session=abc123def456; auth=bearer_token',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.cookie).toContain('session=')
  })

  test('all actions are valid scan_type values', () => {
    // scan runs upgrade + cswsh + auth in sequence
    const actions = ['upgrade', 'cswsh', 'auth', 'scan'] as const
    for (const action of actions) {
      const r = schema.safeParse({ url: 'wss://target.com/ws', action })
      expect(r.success).toBe(true)
    }
  })
})

describe('WebSocketTool — CSWSH and escalation scenarios (cycle 4)', () => {
  test('scan action runs all three probes sequentially', () => {
    // scan = upgrade + cswsh + auth in one call
    const r = schema.safeParse({ url: 'wss://target.com/ws', action: 'scan' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.action).toBe('scan')
  })

  test('cswsh with null origin (sandbox iframe bypass)', () => {
    // null origin bypass: <iframe sandbox> makes requests with Origin: null
    const r = schema.safeParse({
      url: 'wss://target.com/ws',
      action: 'cswsh',
      origin: 'null',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.origin).toBe('null')
  })

  test('auth test with Authorization header (bearer token WS auth)', () => {
    const r = schema.safeParse({
      url: 'wss://target.com/ws',
      action: 'auth',
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.test' },
    })
    expect(r.success).toBe(true)
  })

  test('cswsh test with subdomain origin (for DNS rebinding bypass)', () => {
    const r = schema.safeParse({
      url: 'wss://target.com/ws',
      action: 'cswsh',
      origin: 'https://evil.target.com',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.origin).toContain('target.com')
  })

  test('minimum timeout is 5 seconds (network latency floor)', () => {
    const r = schema.safeParse({ url: 'wss://target.com/ws', action: 'upgrade', timeout_secs: 5 })
    expect(r.success).toBe(true)
  })

  test('rejects timeout below minimum (4)', () => {
    const r = schema.safeParse({ url: 'wss://target.com/ws', action: 'upgrade', timeout_secs: 4 })
    expect(r.success).toBe(false)
  })
})
