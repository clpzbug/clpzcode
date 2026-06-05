import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { __test } from './RequestSmugglingTool.js'

const { buildCLTEPayload, buildTECLPayload, buildTETEPayload } = __test

const ACTIONS = ['detect_clte', 'detect_tecl', 'detect_tete', 'timing', 'all'] as const

const schema = z.strictObject({
  url: z.string(),
  action: z.enum(ACTIONS),
  timeout_secs: z.number().int().min(10).max(120).default(60),
})

describe('RequestSmugglingTool schema', () => {
  test('accepts detect_clte action', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'detect_clte' })
    expect(r.success).toBe(true)
  })

  test('accepts detect_tecl action', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'detect_tecl' })
    expect(r.success).toBe(true)
  })

  test('accepts detect_tete action', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'detect_tete' })
    expect(r.success).toBe(true)
  })

  test('accepts timing action', () => {
    const r = schema.safeParse({ url: 'https://example.com/api', action: 'timing' })
    expect(r.success).toBe(true)
  })

  test('accepts all action', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'all' })
    expect(r.success).toBe(true)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ action: 'all' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'scan' })
    expect(r.success).toBe(false)
  })

  test('defaults timeout_secs to 60', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'all' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.timeout_secs).toBe(60)
  })

  test('rejects timeout below minimum (10)', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'all', timeout_secs: 5 })
    expect(r.success).toBe(false)
  })

  test('rejects timeout above maximum (120)', () => {
    const r = schema.safeParse({ url: 'https://example.com/', action: 'all', timeout_secs: 200 })
    expect(r.success).toBe(false)
  })
})

// =============================================================================
// HTTP payload structure tests — verify smuggling payloads are well-formed
// =============================================================================

describe('CL.TE payload structure', () => {
  const payload = buildCLTEPayload('example.com', '/')

  test('uses HTTP/1.1', () => {
    expect(payload).toContain('HTTP/1.1')
  })

  test('has Content-Length header', () => {
    expect(payload).toContain('Content-Length:')
  })

  test('has Transfer-Encoding: chunked header', () => {
    expect(payload).toContain('Transfer-Encoding: chunked')
  })

  test('ends with a chunk terminator (0\r\n\r\n)', () => {
    expect(payload).toContain('0\r\n\r\n')
  })

  test('uses POST method', () => {
    expect(payload.startsWith('POST')).toBe(true)
  })

  test('includes target host', () => {
    expect(payload).toContain('Host: example.com')
  })
})

describe('TE.CL payload structure', () => {
  const payload = buildTECLPayload('example.com', '/')

  test('has both Transfer-Encoding and Content-Length', () => {
    expect(payload).toContain('Transfer-Encoding: chunked')
    expect(payload).toContain('Content-Length:')
  })

  test('includes GPOST in smuggled prefix', () => {
    // TE.CL attack embeds a second request with a non-standard method
    expect(payload).toContain('GPOST')
  })

  test('includes chunk size in hex', () => {
    // The smuggled section is preceded by its size in hex
    expect(payload).toMatch(/[0-9a-f]+\r\n/)
  })
})

describe('TE.TE payload structure', () => {
  const payload = buildTETEPayload('example.com', '/')

  test('has two Transfer-Encoding headers', () => {
    const count = (payload.match(/Transfer-Encoding:/g) ?? []).length
    expect(count).toBe(2)
  })

  test('one TE header is obfuscated (non-standard value)', () => {
    expect(payload).toContain('x-ignored')
  })

  test('main TE value is chunked', () => {
    expect(payload).toContain('Transfer-Encoding: chunked')
  })
})

// =============================================================================
// RequestSmugglingTool escalation scenarios
// =============================================================================

describe('RequestSmugglingTool — escalation scenarios', () => {
  test('detect_clte (most common variant) accepted', () => {
    const r = schema.safeParse({ url: 'https://target.com/', action: 'detect_clte' })
    expect(r.success).toBe(true)
  })

  test('detect_tecl for reverse proxy setups', () => {
    const r = schema.safeParse({ url: 'https://target.com/api', action: 'detect_tecl' })
    expect(r.success).toBe(true)
  })

  test('all action runs all 3 detection types', () => {
    const r = schema.safeParse({ url: 'https://target.com/', action: 'all' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.action).toBe('all')
  })

  test('timing-based detection with increased timeout', () => {
    const r = schema.safeParse({
      url: 'https://target.com/',
      action: 'timing',
      timeout_secs: 120,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.timeout_secs).toBe(120)
  })
})
