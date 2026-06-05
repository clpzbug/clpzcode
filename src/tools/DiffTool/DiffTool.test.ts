import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { __test } from './DiffTool.js'

const { computeAnomaly, buildRequestParams, buildBaselineParams } = __test

const ACTIONS = ['compare', 'timing', 'reflection'] as const

const schema = z.object({
  url: z.string(),
  action: z.enum(ACTIONS),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  inject_header: z.string().optional(),
  payloads: z.array(z.string()).min(1).max(20),
  marker: z.string().optional(),
  samples: z.number().int().min(1).max(10).default(3),
  timeout_secs: z.number().int().min(5).max(120).default(30),
})

describe('DiffTool schema', () => {
  test('accepts compare action with payloads', () => {
    const r = schema.safeParse({ url: 'https://example.com/page?id=INJECT', action: 'compare', payloads: ['1', "1 OR 1=1--"] })
    expect(r.success).toBe(true)
  })

  test('accepts timing action', () => {
    const r = schema.safeParse({ url: 'https://example.com/page?id=INJECT', action: 'timing', payloads: ['1', '1 AND SLEEP(5)--'] })
    expect(r.success).toBe(true)
  })

  test('accepts reflection action with marker', () => {
    const r = schema.safeParse({ url: 'https://example.com/search?q=INJECT', action: 'reflection', payloads: ['clpzXX7k'], marker: 'clpzXX7k' })
    expect(r.success).toBe(true)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ action: 'compare', payloads: ['test'] })
    expect(r.success).toBe(false)
  })

  test('rejects missing payloads', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'compare' })
    expect(r.success).toBe(false)
  })

  test('rejects empty payloads array', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'compare', payloads: [] })
    expect(r.success).toBe(false)
  })

  test('rejects too many payloads (>20)', () => {
    const many = Array.from({ length: 21 }, (_, i) => `payload${i}`)
    const r = schema.safeParse({ url: 'https://example.com', action: 'compare', payloads: many })
    expect(r.success).toBe(false)
  })

  test('defaults method to GET', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'compare', payloads: ['a'] })
    if (r.success) expect(r.data.method).toBe('GET')
  })

  test('defaults samples to 3', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'timing', payloads: ['a', 'b'] })
    if (r.success) expect(r.data.samples).toBe(3)
  })

  test('accepts inject_header for header injection', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'compare', payloads: ['val'], inject_header: 'X-Forwarded-For' })
    expect(r.success).toBe(true)
  })
})

// =============================================================================
// computeAnomaly — anomaly scoring (0–100) used to flag injection/blind diffs
// =============================================================================

describe('computeAnomaly', () => {
  const base = { status: 200, body: 'x', time_ms: 100 }

  test('identical response with no reflection scores 0', () => {
    const r = computeAnomaly(base, { status: 200, body: 'x', time_ms: 100 }, '')
    expect(r.score).toBe(0)
    expect(r.evidence).toHaveLength(0)
  })

  test('status change adds 40', () => {
    const r = computeAnomaly(base, { status: 500, body: 'x', time_ms: 100 }, '')
    expect(r.score).toBe(40)
    expect(r.evidence.some(e => e.includes('Status changed'))).toBe(true)
  })

  test('large body delta (>500B) adds floor(diff/100) capped at 30', () => {
    const r = computeAnomaly({ status: 200, body: '', time_ms: 100 }, { status: 200, body: 'a'.repeat(5000), time_ms: 100 }, '')
    expect(r.score).toBe(30)
  })

  test('medium body delta (100–500B) adds 10', () => {
    const r = computeAnomaly({ status: 200, body: '', time_ms: 100 }, { status: 200, body: 'a'.repeat(200), time_ms: 100 }, '')
    expect(r.score).toBe(10)
  })

  test('timing delta >5s adds 30 (strong time-based indicator)', () => {
    const r = computeAnomaly(base, { status: 200, body: 'x', time_ms: 6000 }, '')
    expect(r.score).toBe(30)
    expect(r.evidence.some(e => e.includes('strong time-based'))).toBe(true)
  })

  test('timing delta 2–5s adds 10', () => {
    const r = computeAnomaly(base, { status: 200, body: 'x', time_ms: 3000 }, '')
    expect(r.score).toBe(10)
  })

  test('error pattern in body adds 15', () => {
    const r = computeAnomaly({ status: 200, body: 'x'.repeat(21), time_ms: 100 }, { status: 200, body: 'SQL syntax error here', time_ms: 100 }, '')
    expect(r.score).toBe(15)
  })

  test('reflected payload (>=4 chars) adds 20', () => {
    const r = computeAnomaly({ status: 200, body: 'xxxxxxxx', time_ms: 100 }, { status: 200, body: 'clpzXX7k', time_ms: 100 }, 'clpzXX7k')
    expect(r.score).toBe(20)
    expect(r.evidence.some(e => e.includes('reflected'))).toBe(true)
  })

  test('short payload (<4 chars) is not counted as reflection', () => {
    const r = computeAnomaly({ status: 200, body: 'abcxxxxx', time_ms: 100 }, { status: 200, body: 'abcxxxxx', time_ms: 100 }, 'abc')
    expect(r.score).toBe(0)
  })

  test('combined anomalies are capped at 100', () => {
    const r = computeAnomaly(
      { status: 200, body: '', time_ms: 100 },
      { status: 500, body: `syntax error clpzXX7k${'a'.repeat(5000)}`, time_ms: 8000 },
      'clpzXX7k',
    )
    expect(r.score).toBe(100)
  })
})

// =============================================================================
// Pentest-specific detection scenario tests
// =============================================================================

describe('DiffTool — pentest injection detection scenarios', () => {
  const base = { status: 200, body: 'normal response body here', time_ms: 200 }

  test('time-based SQLi: 5s+ delay flags as high anomaly (≥30 pts)', () => {
    // SLEEP(5) → response delayed by 5+ seconds (timeDiff = 5500-200 = 5300 > 5000 → 30 pts)
    const r = computeAnomaly(base, { status: 200, body: 'normal response body here', time_ms: 5500 }, "1' AND SLEEP(5)--")
    expect(r.score).toBeGreaterThanOrEqual(30)
    // Evidence says "${N}ms slower than baseline — strong time-based indicator"
    expect(r.evidence.some(e => e.toLowerCase().includes('slower') || e.toLowerCase().includes('baseline'))).toBe(true)
  })

  test('time-based SSTI: 2s delay is noteworthy (≥10 pts)', () => {
    // ${7*7} with time-based engine side-effect
    const r = computeAnomaly(base, { status: 200, body: 'normal response body here', time_ms: 2500 }, '${7*7}')
    expect(r.score).toBeGreaterThanOrEqual(10)
  })

  test('error-based SQLi: SQL syntax error in response flags high anomaly', () => {
    const sqlError = "You have an error in your SQL syntax; check the manual"
    const r = computeAnomaly(base, { status: 500, body: sqlError, time_ms: 200 }, "' OR 1=1--")
    expect(r.score).toBeGreaterThanOrEqual(40) // status change (40) + error pattern (15) = 55+
    expect(r.evidence.some(e => e.toLowerCase().includes('status'))).toBe(true)
  })

  test('stack trace in response flags anomaly (server-side error)', () => {
    const stackTrace = "Exception at line 42\n\tat com.example.Main(Main.java:42)"
    const r = computeAnomaly(base, { status: 500, body: stackTrace, time_ms: 200 }, 'test payload')
    expect(r.score).toBeGreaterThanOrEqual(40) // status change at minimum
  })

  test('SSTI confirmation: unique 8-char marker reflected (20 pts)', () => {
    // Use a proper marker ≥4 chars to trigger reflection detection
    // In real testing, marker would be a unique 8+ char string like 'clpzXX7k'
    const marker = 'clpzSSTI'
    const r = computeAnomaly(base, { status: 200, body: `template result: ${marker} rendered`, time_ms: 200 }, marker)
    expect(r.score).toBeGreaterThanOrEqual(20) // marker reflected
    expect(r.evidence.some(e => e.includes('reflected'))).toBe(true)
  })
})

// =============================================================================
// buildRequestParams — INJECT placeholder substitution tests
// =============================================================================

describe('DiffTool buildRequestParams — INJECT substitution', () => {
  const mockInput = {
    url: 'http://target/search?q=INJECT',
    action: 'compare' as const,
    method: 'GET' as const,
    headers: {},
    body: undefined,
    inject_header: undefined,
    payloads: ["' OR 1=1--"],
    marker: undefined,
    samples: 3,
    timeout_secs: 30,
  }

  test('INJECT in URL is replaced with URL-encoded payload', () => {
    const req = buildRequestParams(mockInput, "' OR 1=1--")
    // encodeURIComponent converts ' to %27, space to %20, = to %3D
    expect(req.url).not.toContain('INJECT') // placeholder replaced
    expect(req.url).toContain('%3D1') // = sign encoded
    expect(req.url).toContain('1--') // end of payload preserved
  })

  test('baseline URL removes INJECT placeholder', () => {
    const base = buildBaselineParams(mockInput)
    expect(base.url).not.toContain('INJECT')
    expect(base.url).toContain('q=') // param still present, value empty
  })

  test('inject_header replaces header value with payload', () => {
    const withHeader = { ...mockInput, inject_header: 'X-Forwarded-For' }
    const req = buildRequestParams(withHeader, '127.0.0.1')
    expect(req.headers['X-Forwarded-For']).toBe('127.0.0.1')
  })
})
