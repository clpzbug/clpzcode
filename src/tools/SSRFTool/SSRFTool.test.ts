import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { __test } from './SSRFTool.js'

const { getBypassVariants, INTERNAL_TARGETS, getCloudHeaders } = __test

const ACTIONS = ['probe', 'scan', 'bypass', 'oob'] as const

const schema = z.strictObject({
  url: z.string(),
  action: z.enum(ACTIONS),
  target: z.string().optional(),
  oob_url: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  timeout_secs: z.number().int().min(5).max(300).default(30),
})

describe('SSRFTool schema', () => {
  test('accepts valid probe action', () => {
    const r = schema.safeParse({
      url: 'https://example.com/fetch?url=INJECT',
      action: 'probe',
      target: 'http://169.254.169.254',
    })
    expect(r.success).toBe(true)
  })

  test('accepts scan action without target', () => {
    const r = schema.safeParse({ url: 'https://example.com/fetch?url=INJECT', action: 'scan' })
    expect(r.success).toBe(true)
  })

  test('accepts bypass action', () => {
    const r = schema.safeParse({
      url: 'https://example.com/fetch?url=INJECT',
      action: 'bypass',
      target: 'http://127.0.0.1',
    })
    expect(r.success).toBe(true)
  })

  test('accepts oob action with oob_url', () => {
    const r = schema.safeParse({
      url: 'https://example.com/fetch?url=INJECT',
      action: 'oob',
      oob_url: 'http://callback.burpcollaborator.net',
    })
    expect(r.success).toBe(true)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ action: 'scan' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'xss' })
    expect(r.success).toBe(false)
  })

  test('defaults method to GET', () => {
    const r = schema.safeParse({ url: 'https://example.com/fetch?url=INJECT', action: 'scan' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.method).toBe('GET')
  })

  test('defaults timeout_secs to 30', () => {
    const r = schema.safeParse({ url: 'https://example.com/fetch?url=INJECT', action: 'scan' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.timeout_secs).toBe(30)
  })

  test('rejects timeout out of range', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'scan', timeout_secs: 400 })
    expect(r.success).toBe(false)
  })

  test('accepts headers object', () => {
    const r = schema.safeParse({
      url: 'https://example.com/fetch?url=INJECT',
      action: 'scan',
      headers: { 'Authorization': 'Bearer token123' },
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.headers?.['Authorization']).toBe('Bearer token123')
  })

  test('accepts POST method', () => {
    const r = schema.safeParse({
      url: 'https://example.com/fetch',
      action: 'probe',
      method: 'POST',
      target: 'http://127.0.0.1',
    })
    expect(r.success).toBe(true)
  })

  test('accepts PUT method', () => {
    const r = schema.safeParse({
      url: 'https://example.com/fetch',
      action: 'probe',
      method: 'PUT',
      target: 'http://127.0.0.1',
    })
    expect(r.success).toBe(true)
  })
})

// =============================================================================
// getBypassVariants tests
// =============================================================================

describe('getBypassVariants — localhost', () => {
  test('returns original target plus bypass variants', () => {
    const variants = getBypassVariants('http://127.0.0.1/')
    expect(variants.length).toBeGreaterThan(1)
    expect(variants).toContain('http://127.0.0.1/')
  })

  test('includes decimal IP variant for 127.0.0.1', () => {
    const variants = getBypassVariants('http://127.0.0.1/')
    expect(variants.some(v => v.includes('2130706433'))).toBe(true)
  })

  test('includes localhost.localdomain for localhost', () => {
    const variants = getBypassVariants('http://localhost/')
    expect(variants.some(v => v.includes('localdomain'))).toBe(true)
  })

  test('includes octal variant for 127.0.0.1', () => {
    const variants = getBypassVariants('http://127.0.0.1/')
    expect(variants.some(v => v.includes('0177'))).toBe(true)
  })

  test('no duplicate entries', () => {
    const variants = getBypassVariants('http://127.0.0.1/')
    const unique = new Set(variants)
    expect(unique.size).toBe(variants.length)
  })
})

describe('getBypassVariants — metadata endpoint', () => {
  test('returns bypass variants for 169.254.169.254', () => {
    const variants = getBypassVariants('http://169.254.169.254/')
    expect(variants.length).toBeGreaterThan(1)
  })

  test('includes hex variant for metadata IP', () => {
    const variants = getBypassVariants('http://169.254.169.254/')
    expect(variants.some(v => v.includes('0xa9fea9fe'))).toBe(true)
  })

  test('includes decimal variant for metadata IP', () => {
    const variants = getBypassVariants('http://169.254.169.254/')
    expect(variants.some(v => v.includes('2852039166'))).toBe(true)
  })
})

describe('getBypassVariants — other targets', () => {
  test('generates numeric + scheme variants for any IPv4 host', () => {
    // Enhanced behavior: encodes ANY literal IPv4, not just loopback/metadata.
    const variants = getBypassVariants('http://10.0.0.1/internal')
    expect(variants).toContain('http://10.0.0.1/internal')
    // 10.0.0.1 → 32-bit dword 167772161
    expect(variants.some(v => v.includes('167772161'))).toBe(true)
    expect(variants.some(v => v.startsWith('gopher://'))).toBe(true)
  })

  test('handles invalid URL gracefully (returns input unchanged)', () => {
    const variants = getBypassVariants('not-a-url')
    expect(variants).toEqual(['not-a-url'])
  })
})

describe('getBypassVariants — alternate schemes', () => {
  test('includes gopher:// scheme variant (Redis/SMTP interaction)', () => {
    const variants = getBypassVariants('http://127.0.0.1:6379/')
    expect(variants.some(v => v.startsWith('gopher://'))).toBe(true)
  })

  test('includes dict:// scheme variant', () => {
    const variants = getBypassVariants('http://127.0.0.1:6379/')
    expect(variants.some(v => v.startsWith('dict://'))).toBe(true)
  })

  test('includes file:// local-file-read variant (SSRF→LFI)', () => {
    const variants = getBypassVariants('http://127.0.0.1/')
    expect(variants.some(v => v.startsWith('file://') && v.includes('/etc/passwd'))).toBe(true)
  })

  test('includes netdoc:// (Java) local-file-read variant', () => {
    const variants = getBypassVariants('http://127.0.0.1/')
    expect(variants.some(v => v.startsWith('netdoc://'))).toBe(true)
  })

  test('includes credential-prefix confusion variant', () => {
    const variants = getBypassVariants('http://127.0.0.1/')
    expect(variants.some(v => v.includes('@evil.example.com'))).toBe(true)
  })
})

// =============================================================================
// INTERNAL_TARGETS tests
// =============================================================================

describe('INTERNAL_TARGETS', () => {
  test('has at least 8 internal targets', () => {
    expect(INTERNAL_TARGETS.length).toBeGreaterThanOrEqual(8)
  })

  test('includes AWS metadata endpoint', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('169.254.169.254'))).toBe(true)
  })

  test('includes GCP metadata endpoint', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('metadata.google.internal'))).toBe(true)
  })

  test('includes localhost', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('localhost'))).toBe(true)
  })

  test('all entries use http:// or file:// scheme', () => {
    for (const t of INTERNAL_TARGETS) {
      expect(t.startsWith('http://') || t.startsWith('file://')).toBe(true)
    }
  })

  test('includes Redis port target', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('6379'))).toBe(true)
  })

  test('includes Alibaba Cloud metadata endpoint (100.100.100.200)', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('100.100.100.200'))).toBe(true)
  })

  test('includes DigitalOcean metadata endpoint (/metadata/v1/)', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('/metadata/v1/'))).toBe(true)
  })

  test('includes Oracle Cloud (OCI) metadata endpoint (/opc/v1/instance/)', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('/opc/v1/instance/'))).toBe(true)
  })

  test('includes file:// local-file-read target', () => {
    expect(INTERNAL_TARGETS.some(t => t.startsWith('file://') && t.includes('/etc/passwd'))).toBe(true)
  })

  test('includes Elasticsearch port 9200', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('9200'))).toBe(true)
  })

  test('includes Docker daemon port 2375', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('2375'))).toBe(true)
  })
})

// =============================================================================
// getCloudHeaders tests — cloud providers require specific headers
// =============================================================================

describe('getCloudHeaders', () => {
  test('GCP metadata requires Metadata-Flavor: Google', () => {
    const h = getCloudHeaders('http://metadata.google.internal/computeMetadata/v1/')
    expect(h['Metadata-Flavor']).toBe('Google')
  })

  test('Azure metadata requires Metadata: true', () => {
    const h = getCloudHeaders('http://169.254.169.254/metadata/instance?api-version=2021-02-01')
    expect(h['Metadata']).toBe('true')
  })

  test('AWS metadata needs no special headers', () => {
    const h = getCloudHeaders('http://169.254.169.254/latest/meta-data/')
    expect(Object.keys(h)).toHaveLength(0)
  })

  test('arbitrary URL needs no special headers', () => {
    const h = getCloudHeaders('http://127.0.0.1:6379/')
    expect(Object.keys(h)).toHaveLength(0)
  })
}
)

describe('SSRFTool INTERNAL_TARGETS — extended cloud/internal targets', () => {
  test('includes Consul agent port 8500', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('8500'))).toBe(true)
  })

  test('includes Kubernetes API port 6443', () => {
    expect(INTERNAL_TARGETS.some(t => t.includes('6443'))).toBe(true)
  })

  test('cloud metadata targets use http scheme (not https)', () => {
    // Cloud metadata endpoints are accessible only over HTTP inside VPCs
    const cloudTargets = INTERNAL_TARGETS.filter(t =>
      t.includes('169.254.169.254') || t.includes('metadata.google.internal') || t.includes('100.100.100.200')
    )
    expect(cloudTargets.every(t => t.startsWith('http://'))).toBe(true)
  })
})
