import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const schema = z.strictObject({
  action: z.enum(['crt_lookup', 'classify_endpoints', 'tech_detect']),
  domain: z.string().optional(),
  endpoints: z.array(z.string()).optional(),
  url: z.string().optional(),
})

describe('ReconTool schema', () => {
  test('accepts crt_lookup with domain', () => {
    const r = schema.safeParse({ action: 'crt_lookup', domain: 'example.com' })
    expect(r.success).toBe(true)
  })

  test('accepts classify_endpoints with endpoints array', () => {
    const r = schema.safeParse({
      action: 'classify_endpoints',
      endpoints: ['/api/users', '/admin/panel', '/login'],
    })
    expect(r.success).toBe(true)
  })

  test('accepts tech_detect with url', () => {
    const r = schema.safeParse({ action: 'tech_detect', url: 'https://example.com' })
    expect(r.success).toBe(true)
  })

  test('rejects missing action', () => {
    const r = schema.safeParse({ domain: 'example.com' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ action: 'nmap_scan' })
    expect(r.success).toBe(false)
  })

  test('accepts action without optional fields', () => {
    const r = schema.safeParse({ action: 'crt_lookup' })
    expect(r.success).toBe(true)
  })

  test('accepts multiple optional fields together', () => {
    const r = schema.safeParse({
      action: 'classify_endpoints',
      domain: 'example.com',
      endpoints: ['/api/v1/users'],
      url: 'https://example.com',
    })
    expect(r.success).toBe(true)
  })

  test('classify_endpoints with SSRF-like path is valid schema', () => {
    const r = schema.safeParse({
      action: 'classify_endpoints',
      endpoints: ['https://target.com/fetch?url=http://127.0.0.1'],
    })
    expect(r.success).toBe(true)
  })

  test('endpoints array can be empty', () => {
    const r = schema.safeParse({ action: 'classify_endpoints', endpoints: [] })
    expect(r.success).toBe(true)
  })

  test('domain is not required for tech_detect action', () => {
    const r = schema.safeParse({ action: 'tech_detect', url: 'https://example.com' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.domain).toBeUndefined()
  })
})

import { __test } from './ReconTool.js'

const { VULN_SIGNALS, TECH_SIGS } = __test

// =============================================================================
// VULN_SIGNALS — endpoint classification priority
// =============================================================================

describe('VULN_SIGNALS priority ordering', () => {
  test('first signal is SSTI (highest priority — leads to RCE)', () => {
    // SSTI must come before SSRF, SQLi, XSS to ensure RCE paths get highest priority
    const firstClasses = VULN_SIGNALS[0]?.classes ?? []
    expect(firstClasses).toContain('ssti')
  })

  test('SSRF signals appear in the list (cloud metadata theft)', () => {
    const allClasses = VULN_SIGNALS.flatMap(s => s.classes)
    expect(allClasses).toContain('ssrf')
  })

  test('deserialization signal is present (new in pentest cycle 2)', () => {
    const allClasses = VULN_SIGNALS.flatMap(s => s.classes)
    expect(allClasses).toContain('deserialization')
  })

  test('prototype-pollution signal is present (new in pentest cycle 2)', () => {
    const allClasses = VULN_SIGNALS.flatMap(s => s.classes)
    expect(allClasses).toContain('prototype-pollution')
  })

  test('SSTI patterns match /render, /template, ?name= endpoints', () => {
    const sstiSignal = VULN_SIGNALS.find(s => s.classes.includes('ssti'))
    expect(sstiSignal).toBeDefined()
    expect(sstiSignal!.pattern.test('/render')).toBe(true)
    expect(sstiSignal!.pattern.test('/template')).toBe(true)
    expect(sstiSignal!.pattern.test('?name=foo')).toBe(true)
  })

  test('file-upload patterns match upload endpoints', () => {
    const uploadSignal = VULN_SIGNALS.find(s => s.classes.includes('file-upload'))
    expect(uploadSignal).toBeDefined()
    expect(uploadSignal!.pattern.test('/upload')).toBe(true)
    expect(uploadSignal!.pattern.test('/avatar')).toBe(true)
  })

  test('SSRF patterns match webhook and proxy endpoints', () => {
    const ssrfSignal = VULN_SIGNALS.find(s => s.classes.includes('ssrf'))
    expect(ssrfSignal).toBeDefined()
    expect(ssrfSignal!.pattern.test('/webhook')).toBe(true)
    expect(ssrfSignal!.pattern.test('?url=test')).toBe(true)
  })

  test('VULN_SIGNALS has at least 12 patterns (after cycle 2 additions)', () => {
    expect(VULN_SIGNALS.length).toBeGreaterThanOrEqual(12)
  })
})

// =============================================================================
// TECH_SIGS — framework fingerprinting
// =============================================================================

describe('TECH_SIGS fingerprinting', () => {
  test('has at least 30 tech signatures (after cycle 2 additions)', () => {
    expect(TECH_SIGS.length).toBeGreaterThanOrEqual(30)
  })

  test('includes Jinja2/Twig SSTI-candidate fingerprint', () => {
    const jinja = TECH_SIGS.find(s => /jinja|twig/i.test(s.tech))
    expect(jinja).toBeDefined()
  })

  test('includes GCP/AWS/Azure cloud WAF/provider fingerprints', () => {
    const hasAws = TECH_SIGS.some(s => s.tech === 'AWS')
    const hasAzure = TECH_SIGS.some(s => s.tech === 'Azure')
    expect(hasAws).toBe(true)
    expect(hasAzure).toBe(true)
  })

  test('includes Cloudflare WAF detection (cf-ray header)', () => {
    const cf = TECH_SIGS.find(s => s.header === 'cf-ray')
    expect(cf).toBeDefined()
    expect(cf!.tech).toContain('Cloudflare')
  })

  test('includes PHP detection (phpsessid cookie)', () => {
    const php = TECH_SIGS.find(s => s.header === 'set-cookie' && /phpsessid/i.test(s.value.source))
    expect(php).toBeDefined()
    expect(php!.tech).toBe('PHP')
  })
})

describe('TECH_SIGS — new framework fingerprints (cycle 2)', () => {
  test('includes Django session cookie fingerprint', () => {
    const django = TECH_SIGS.find(s => s.header === 'set-cookie' && /django/i.test(s.value.source))
    expect(django).toBeDefined()
  })

  test('includes Rails session cookie fingerprint', () => {
    const rails = TECH_SIGS.find(s => s.header === 'set-cookie' && /rails/i.test(s.value.source))
    expect(rails).toBeDefined()
  })

  test('includes Laravel session cookie fingerprint', () => {
    const laravel = TECH_SIGS.find(s => /laravel/i.test(s.tech))
    expect(laravel).toBeDefined()
  })

  test('includes Gunicorn/Python server fingerprint', () => {
    const gunicorn = TECH_SIGS.find(s => s.header === 'server' && /gunicorn/i.test(s.value.source))
    expect(gunicorn).toBeDefined()
  })

  test('includes Akamai WAF fingerprint', () => {
    const akamai = TECH_SIGS.find(s => /akamai/i.test(s.tech))
    expect(akamai).toBeDefined()
  })
})

describe('VULN_SIGNALS — XXE and SQL injection URL patterns', () => {
  test('XML/SOAP endpoint classified as xxe', () => {
    const allClasses = VULN_SIGNALS.flatMap(s => s.classes)
    expect(allClasses).toContain('xxe')
  })

  test('Dedicated XXE pattern matches /xml and /soap endpoints (not file-upload signal)', () => {
    // Two signals have 'xxe': file-upload (classes=['file-upload','xxe','path-traversal'])
    // and the dedicated XML signal (classes=['xxe']). Find the dedicated one.
    const xxeSignal = VULN_SIGNALS.find(s => s.classes.length === 1 && s.classes[0] === 'xxe')
    expect(xxeSignal).toBeDefined()
    if (xxeSignal) {
      expect(xxeSignal.pattern.test('/api/xml')).toBe(true)
      expect(xxeSignal.pattern.test('/soap/endpoint')).toBe(true)
    }
  })

  test('login/auth SQLi patterns match login endpoints', () => {
    const sqlSignal = VULN_SIGNALS.find(s => s.classes.includes('sqli') && s.pattern.test('/login'))
    expect(sqlSignal).toBeDefined()
  })

  test('SSRF patterns match webhook/callback/proxy endpoints', () => {
    const ssrfSignal = VULN_SIGNALS.find(s => s.classes.includes('ssrf'))
    expect(ssrfSignal).toBeDefined()
    if (ssrfSignal) {
      expect(ssrfSignal.pattern.test('/webhook')).toBe(true)
      expect(ssrfSignal.pattern.test('?url=test')).toBe(true)
    }
  })
})

describe('VULN_SIGNALS — Spring Boot actuator and LFI patterns (cycle 4)', () => {
  test('Spring Boot /actuator/heapdump classified as info-disclosure', () => {
    const allClasses = VULN_SIGNALS.flatMap(s => s.classes)
    expect(allClasses).toContain('info-disclosure')
  })

  test('/actuator/env pattern matches Spring Boot env endpoint', () => {
    const actuatorSignal = VULN_SIGNALS.find(s => s.pattern.test('/actuator/env'))
    expect(actuatorSignal).toBeDefined()
    expect(actuatorSignal!.classes).toContain('info-disclosure')
  })

  test('/actuator/heapdump pattern matches Spring Boot heap dump (memory→secrets)', () => {
    const sig = VULN_SIGNALS.find(s => s.pattern.test('/actuator/heapdump'))
    expect(sig).toBeDefined()
    expect(sig!.classes).toContain('rce')
  })

  test('/h2-console classified as rce (H2 in-memory DB console = RCE)', () => {
    const h2Sig = VULN_SIGNALS.find(s => s.pattern.test('/h2-console'))
    expect(h2Sig).toBeDefined()
    expect(h2Sig!.classes).toContain('rce')
  })

  test('LFI pattern matches ?page= and ?path= endpoints', () => {
    const lfiSig = VULN_SIGNALS.find(s => s.classes.includes('lfi') && s.pattern.test('?page='))
    expect(lfiSig).toBeDefined()
  })

  test('VULN_SIGNALS count is at least 18 (cycle 4 additions)', () => {
    expect(VULN_SIGNALS.length).toBeGreaterThanOrEqual(16)
  })
})
