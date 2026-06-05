import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { __test } from './CORSTool.js'

const { parseHeader, parseStatus, assessSeverity, buildScanOrigins } = __test

const schema = z.object({
  url: z.string(),
  origin: z.string().optional(),
  action: z.enum(['test', 'scan']),
  method: z.enum(['GET', 'POST', 'PUT']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  timeout_secs: z.number().int().min(5).max(120).default(30),
})

describe('CORSTool schema', () => {
  test('accepts valid test action with url', () => {
    const r = schema.safeParse({ url: 'https://example.com/api', action: 'test' })
    expect(r.success).toBe(true)
  })

  test('accepts scan action', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'scan' })
    expect(r.success).toBe(true)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ action: 'test' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'fuzz' })
    expect(r.success).toBe(false)
  })

  test('defaults method to GET', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'scan' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.method).toBe('GET')
  })

  test('defaults timeout_secs to 30', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'test' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.timeout_secs).toBe(30)
  })

  test('rejects timeout below minimum', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'test', timeout_secs: 4 })
    expect(r.success).toBe(false)
  })

  test('accepts optional origin header for test action', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'test', origin: 'https://evil.com' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.origin).toBe('https://evil.com')
  })

  test('accepts POST method', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'test', method: 'POST' })
    expect(r.success).toBe(true)
  })

  test('accepts additional headers object', () => {
    const r = schema.safeParse({
      url: 'https://example.com',
      action: 'test',
      headers: { Authorization: 'Bearer token123' },
    })
    expect(r.success).toBe(true)
  })

  test('rejects timeout above maximum', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'scan', timeout_secs: 121 })
    expect(r.success).toBe(false)
  })

  test('accepts PUT method', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'test', method: 'PUT' })
    expect(r.success).toBe(true)
  })
})

// =============================================================================
// parseHeader tests
// =============================================================================

describe('parseHeader', () => {
  test('extracts ACAO header', () => {
    const raw = 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: https://evil.com\r\n'
    expect(parseHeader(raw, 'access-control-allow-origin')).toBe('https://evil.com')
  })

  test('is case-insensitive for header name', () => {
    const raw = 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\n'
    expect(parseHeader(raw, 'Access-Control-Allow-Origin')).toBe('*')
  })

  test('returns null for missing header', () => {
    const raw = 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n'
    expect(parseHeader(raw, 'access-control-allow-origin')).toBeNull()
  })

  test('extracts ACAC header', () => {
    const raw = 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Credentials: true\r\n'
    expect(parseHeader(raw, 'access-control-allow-credentials')).toBe('true')
  })

  test('handles multiple headers', () => {
    const raw = 'HTTP/1.1 200 OK\r\nX-Frame-Options: DENY\r\nAccess-Control-Allow-Origin: https://example.com\r\nContent-Type: text/html\r\n'
    expect(parseHeader(raw, 'access-control-allow-origin')).toBe('https://example.com')
  })

  test('returns null for empty input', () => {
    expect(parseHeader('', 'access-control-allow-origin')).toBeNull()
  })

  test('trims whitespace from header value', () => {
    const raw = 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin:   https://evil.com  \r\n'
    expect(parseHeader(raw, 'access-control-allow-origin')).toBe('https://evil.com')
  })
})

// =============================================================================
// parseStatus tests
// =============================================================================

describe('parseStatus', () => {
  test('parses HTTP/1.1 200', () => {
    expect(parseStatus('HTTP/1.1 200 OK\r\nContent-Type: text/html')).toBe(200)
  })

  test('parses HTTP/1.1 403', () => {
    expect(parseStatus('HTTP/1.1 403 Forbidden\r\n')).toBe(403)
  })

  test('parses HTTP/2 200', () => {
    expect(parseStatus('HTTP/2 200\r\n')).toBe(200)
  })

  test('returns 0 for empty string', () => {
    expect(parseStatus('')).toBe(0)
  })

  test('returns 0 for non-HTTP string', () => {
    expect(parseStatus('<html><body></body></html>')).toBe(0)
  })

  test('parses 301 redirect', () => {
    expect(parseStatus('HTTP/1.1 301 Moved Permanently\r\n')).toBe(301)
  })
})

// =============================================================================
// assessSeverity tests
// =============================================================================

describe('assessSeverity', () => {
  test('info when acao is null', () => {
    const r = assessSeverity('https://evil.com', null, false)
    expect(r.vulnerable).toBe(false)
    expect(r.severity).toBe('info')
  })

  test('critical: origin reflected + ACAC true', () => {
    const r = assessSeverity('https://evil.com', 'https://evil.com', true)
    expect(r.vulnerable).toBe(true)
    expect(r.severity).toBe('critical')
  })

  test('high: origin reflected + ACAC false', () => {
    const r = assessSeverity('https://evil.com', 'https://evil.com', false)
    expect(r.vulnerable).toBe(true)
    expect(r.severity).toBe('high')
  })

  test('high: ACAO null origin', () => {
    const r = assessSeverity('null', 'null', false)
    expect(r.vulnerable).toBe(true)
    expect(r.severity).toBe('high')
  })

  test('critical: wildcard ACAO + ACAC true (invalid config)', () => {
    const r = assessSeverity('https://evil.com', '*', true)
    expect(r.vulnerable).toBe(true)
    expect(r.severity).toBe('critical')
  })

  test('info: wildcard ACAO without credentials', () => {
    const r = assessSeverity('https://evil.com', '*', false)
    expect(r.vulnerable).toBe(false)
    expect(r.severity).toBe('info')
  })

  test('info: ACAO set to different origin', () => {
    const r = assessSeverity('https://evil.com', 'https://trusted.com', false)
    expect(r.vulnerable).toBe(false)
    expect(r.severity).toBe('info')
  })

  test('case-insensitive comparison', () => {
    const r = assessSeverity('https://evil.com', 'HTTPS://EVIL.COM', true)
    expect(r.vulnerable).toBe(true)
    expect(r.severity).toBe('critical')
  })

  test('vulnerable result has non-empty details', () => {
    const r = assessSeverity('https://evil.com', 'https://evil.com', true)
    expect(r.details.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// buildScanOrigins tests
// =============================================================================

describe('buildScanOrigins', () => {
  test('returns at least 5 origins for https target', () => {
    const origins = buildScanOrigins('https://target.com/api')
    expect(origins.length).toBeGreaterThanOrEqual(5)
  })

  test('includes evil.com', () => {
    const origins = buildScanOrigins('https://target.com/api')
    expect(origins.some(o => o.includes('evil'))).toBe(true)
  })

  test('includes null origin', () => {
    const origins = buildScanOrigins('https://target.com/api')
    expect(origins).toContain('null')
  })

  test('includes subdomain bypass pattern', () => {
    const origins = buildScanOrigins('https://target.com/api')
    expect(origins.some(o => o.includes('target.com'))).toBe(true)
  })

  test('handles http target', () => {
    const origins = buildScanOrigins('http://target.com/')
    expect(origins.length).toBeGreaterThanOrEqual(5)
  })
})

// =============================================================================
// CORS severity escalation tests — critical vs info
// =============================================================================

describe('CORSTool severity — critical vs informational', () => {
  test('informational: wildcard ACAO without credentials (not exploitable without auth)', () => {
    // ACAO: * without ACAC: true → can't steal authenticated data
    const { vulnerable, severity } = assessSeverity('https://evil.com', '*', false)
    expect(vulnerable).toBe(false) // wildcard without credentials = info only
    expect(severity).toBe('info')
  })

  test('critical: origin reflected WITH credentials (worst case — exfil possible)', () => {
    const { vulnerable, severity } = assessSeverity('https://evil.com', 'https://evil.com', true)
    expect(vulnerable).toBe(true)
    expect(severity).toBe('critical') // CORS ACAC:true with reflected origin = exploit immediately
  })

  test('high: ACAO null — sandboxed iframe bypass possible', () => {
    const { vulnerable, severity } = assessSeverity('null', 'null', false)
    expect(vulnerable).toBe(true)
    expect(severity).toBe('high')
  })
})
