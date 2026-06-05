import { describe, expect, test } from 'bun:test'
import { __test } from './JWTTool.js'

const { parseJWT, b64urlDecode, b64urlEncode, actionDecode, actionCheckExp, actionAlgNone, actionForge, actionAlgConfusion } = __test

// Known test JWT: header={"alg":"HS256","typ":"JWT"} payload={"sub":"1234567890","name":"test","iat":1516239022}
// Signed with secret "secret"
const SAMPLE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6InRlc3QiLCJpYXQiOjE1MTYyMzkwMjJ9.5mhBHqs5_DTLdINd9p5m7ZJ6XD0Xc55KIfCzPRC_p0c'

// JWT with exp in the past (expired)
const EXPIRED_JWT = (() => {
  const h = b64urlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const p = b64urlEncode(Buffer.from(JSON.stringify({ sub: '123', exp: 1000000000, iat: 999999000 })))
  return `${h}.${p}.fakesig`
})()

// JWT with no exp claim
const NO_EXP_JWT = (() => {
  const h = b64urlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const p = b64urlEncode(Buffer.from(JSON.stringify({ sub: '123', role: 'admin' })))
  return `${h}.${p}.fakesig`
})()

// JWT with far-future exp (> 1 year)
const FAR_FUTURE_JWT = (() => {
  const h = b64urlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const farExp = Math.floor(Date.now() / 1000) + 86400 * 400 // 400 days from now
  const p = b64urlEncode(Buffer.from(JSON.stringify({ sub: '123', exp: farExp })))
  return `${h}.${p}.fakesig`
})()

// =============================================================================
// b64urlDecode / b64urlEncode round-trip
// =============================================================================

describe('b64urlDecode', () => {
  test('decodes a standard base64url string', () => {
    const encoded = Buffer.from('hello world').toString('base64url')
    expect(b64urlDecode(encoded)).toBe('hello world')
  })

  test('handles padding-free input', () => {
    const withPad = Buffer.from('test').toString('base64')
    const noPad = withPad.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    expect(b64urlDecode(noPad)).toBe('test')
  })
})

describe('b64urlEncode', () => {
  test('encodes a Buffer', () => {
    const buf = Buffer.from('hello')
    const encoded = b64urlEncode(buf)
    expect(b64urlDecode(encoded)).toBe('hello')
  })

  test('encodes a string', () => {
    const encoded = b64urlEncode('world')
    expect(b64urlDecode(encoded)).toBe('world')
  })

  test('produces no padding characters', () => {
    expect(b64urlEncode(Buffer.from('test'))).not.toContain('=')
  })

  test('uses URL-safe characters (no + or /)', () => {
    for (let i = 0; i < 20; i++) {
      const s = b64urlEncode(Buffer.from(`value-${i}-padding`))
      expect(s).not.toContain('+')
      expect(s).not.toContain('/')
    }
  })
})

// =============================================================================
// parseJWT
// =============================================================================

describe('parseJWT', () => {
  test('parses a valid 3-part JWT', () => {
    const result = parseJWT(SAMPLE_JWT)
    expect(result).not.toBeNull()
    expect(result!.header.alg).toBe('HS256')
    expect(result!.header.typ).toBe('JWT')
    expect(result!.payload.sub).toBe('1234567890')
    expect(result!.payload.name).toBe('test')
  })

  test('returns null for a malformed token (no dots)', () => {
    expect(parseJWT('notajwt')).toBeNull()
  })

  test('returns null for a 2-part token', () => {
    expect(parseJWT('part1.part2')).toBeNull()
  })

  test('returns null for a 4-part token', () => {
    expect(parseJWT('a.b.c.d')).toBeNull()
  })

  test('returns null for invalid base64 in header', () => {
    expect(parseJWT('!!!.eyJzdWIiOiIxIn0.sig')).toBeNull()
  })

  test('returns the signature part as-is', () => {
    const result = parseJWT(SAMPLE_JWT)
    expect(result!.signature).toBe(SAMPLE_JWT.split('.')[2])
  })

  test('strips leading/trailing whitespace before parsing', () => {
    const result = parseJWT(`  ${SAMPLE_JWT}  `)
    expect(result).not.toBeNull()
  })
})

// =============================================================================
// actionDecode
// =============================================================================

describe('actionDecode', () => {
  test('returns decoded header and payload for valid JWT', () => {
    const out = actionDecode(SAMPLE_JWT)
    expect(out.action).toBe('decode')
    expect(out.error).toBeUndefined()
    expect(out.header?.alg).toBe('HS256')
    expect(out.payload?.sub).toBe('1234567890')
  })

  test('returns algorithm in output', () => {
    const out = actionDecode(SAMPLE_JWT)
    expect(out.algorithm).toBe('HS256')
  })

  test('token_preview is first 40 chars + ellipsis for long token', () => {
    const out = actionDecode(SAMPLE_JWT)
    expect(out.token_preview).toHaveLength(43) // 40 + '...'
  })

  test('severity is info for a normal JWT', () => {
    const out = actionDecode(SAMPLE_JWT)
    expect(out.severity).toBe('info')
  })

  test('returns error for malformed token', () => {
    const out = actionDecode('invalid')
    expect(out.error).toBeDefined()
    expect(out.header).toBeUndefined()
  })

  test('finding includes algorithm and kid info', () => {
    const out = actionDecode(SAMPLE_JWT)
    expect(out.finding).toContain('HS256')
  })
})

// =============================================================================
// actionCheckExp
// =============================================================================

describe('actionCheckExp', () => {
  test('detects expired token', () => {
    const out = actionCheckExp(EXPIRED_JWT)
    expect(out.is_expired).toBe(true)
    expect(out.expiry_info).toContain('Expired')
  })

  test('flags missing exp as high severity', () => {
    const out = actionCheckExp(NO_EXP_JWT)
    expect(out.severity).toBe('high')
    expect(out.expiry_info).toContain('No expiry')
    expect(out.is_expired).toBe(false)
  })

  test('flags far-future exp as medium severity', () => {
    const out = actionCheckExp(FAR_FUTURE_JWT)
    expect(out.severity).toBe('medium')
  })

  test('returns error for invalid token', () => {
    const out = actionCheckExp('bad')
    expect(out.error).toBeDefined()
  })

  test('includes iat info in expiry_info', () => {
    const out = actionCheckExp(EXPIRED_JWT)
    expect(out.expiry_info).toContain('Issued at')
  })
})

// =============================================================================
// actionAlgNone
// =============================================================================

describe('actionAlgNone', () => {
  test('generates a forged token with alg=none', () => {
    const out = actionAlgNone(SAMPLE_JWT)
    expect(out.forged_token).toBeDefined()
    const forged = out.forged_token!
    const parts = forged.split('.')
    expect(parts).toHaveLength(3)
    expect(parts[2]).toBe('') // empty signature
  })

  test('forged token header has alg=none', () => {
    const out = actionAlgNone(SAMPLE_JWT)
    const parts = out.forged_token!.split('.')
    const header = JSON.parse(b64urlDecode(parts[0]!))
    expect(header.alg).toBe('none')
  })

  test('payload is preserved unchanged', () => {
    const out = actionAlgNone(SAMPLE_JWT)
    const parts = out.forged_token!.split('.')
    const payload = JSON.parse(b64urlDecode(parts[1]!))
    expect(payload.sub).toBe('1234567890')
  })

  test('severity is critical', () => {
    const out = actionAlgNone(SAMPLE_JWT)
    expect(out.severity).toBe('critical')
  })

  test('returns error for invalid token', () => {
    const out = actionAlgNone('bad.token')
    expect(out.error).toBeDefined()
  })

  test('generates 8 variants (4 case variations × 2 dot/no-dot formats)', () => {
    // The fix generates: none/None/NONE/nOnE × trailing-dot/no-dot = 8 tokens
    // All 8 are in the finding text
    const out = actionAlgNone(SAMPLE_JWT)
    expect(out.finding).toContain('[1]') // first variant
    expect(out.finding).toContain('[8]') // last variant
  })

  test('finding mentions case variants', () => {
    const out = actionAlgNone(SAMPLE_JWT)
    expect(out.finding).toBeDefined()
    // The finding should mention multiple variants
    expect(out.finding!.toLowerCase()).toContain('variant')
  })
})

// =============================================================================
// actionForge
// =============================================================================

describe('actionForge', () => {
  test('forges a token with custom claims', () => {
    const out = actionForge(SAMPLE_JWT, '{"role":"admin"}', 'secret')
    expect(out.forged_token).toBeDefined()
    expect(out.payload?.role).toBe('admin')
  })

  test('preserves original claims when merging', () => {
    const out = actionForge(SAMPLE_JWT, '{"role":"admin"}', 'test-secret')
    expect(out.payload?.sub).toBe('1234567890')
    expect(out.payload?.role).toBe('admin')
  })

  test('custom claim overwrites original claim', () => {
    const out = actionForge(SAMPLE_JWT, '{"name":"hacker"}', 'x')
    expect(out.payload?.name).toBe('hacker')
  })

  test('forged token is a valid 3-part JWT', () => {
    const out = actionForge(SAMPLE_JWT, '{}', 'secret')
    expect(out.forged_token!.split('.')).toHaveLength(3)
  })

  test('alg is forced to HS256', () => {
    const out = actionForge(SAMPLE_JWT, '{}', 'secret')
    expect(out.algorithm).toBe('HS256')
  })

  test('severity is critical', () => {
    const out = actionForge(SAMPLE_JWT, '{"role":"admin"}')
    expect(out.severity).toBe('critical')
  })

  test('returns error for invalid claims JSON', () => {
    const out = actionForge(SAMPLE_JWT, 'not-json', 'secret')
    expect(out.error).toBeDefined()
  })

  test('returns error for invalid token', () => {
    const out = actionForge('notajwt')
    expect(out.error).toBeDefined()
  })

  test('works without claims (empty merge)', () => {
    const out = actionForge(SAMPLE_JWT, undefined, 'my-secret')
    expect(out.forged_token).toBeDefined()
    expect(out.error).toBeUndefined()
  })
})

// =============================================================================
// actionAlgConfusion
// =============================================================================

describe('actionAlgConfusion', () => {
  // Minimal self-signed RSA public key PEM for testing
  const FAKE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2a2rwplBQLzHPZe5TNJT
WBbUFvNhcMVoaLRGjEbzGN5pxe+F5pW5+RjhpJJF8sWrBXq0qxLxMUQkfPEnmBB
ZhKKMcBFiWVS0fS3X+CfVIGy9sLNPFJRETULJVJnfyGLRrECFU6vfxKPHlpVnmEW
fEmMFXN7HVz8D/WKMfXiK2/LPLBJmFYMLNiWP0Yfni5BqxFjvjFGnqNTX5JNUQN
-----END PUBLIC KEY-----`

  test('returns info severity without public_key', () => {
    const out = actionAlgConfusion(SAMPLE_JWT)
    expect(out.severity).toBe('info')
    expect(out.finding).toContain('public_key')
  })

  test('returns error for invalid token', () => {
    const out = actionAlgConfusion('bad.token')
    expect(out.error).toBeDefined()
  })

  test('generates a forged token with public_key', () => {
    const out = actionAlgConfusion(SAMPLE_JWT, FAKE_PUBLIC_KEY)
    expect(out.forged_token).toBeDefined()
    expect(out.error).toBeUndefined()
  })

  test('forged token has alg=HS256 in header', () => {
    const out = actionAlgConfusion(SAMPLE_JWT, FAKE_PUBLIC_KEY)
    const parts = out.forged_token!.split('.')
    expect(parts).toHaveLength(3)
    const header = JSON.parse(b64urlDecode(parts[0]!))
    expect(header.alg).toBe('HS256')
  })

  test('payload is preserved in alg confusion forged token', () => {
    const out = actionAlgConfusion(SAMPLE_JWT, FAKE_PUBLIC_KEY)
    const parts = out.forged_token!.split('.')
    const payload = JSON.parse(b64urlDecode(parts[1]!))
    expect(payload.sub).toBe('1234567890')
  })

  test('severity is critical when public_key provided', () => {
    const out = actionAlgConfusion(SAMPLE_JWT, FAKE_PUBLIC_KEY)
    expect(out.severity).toBe('critical')
  })

  test('finding mentions RS256→HS256 confusion', () => {
    const out = actionAlgConfusion(SAMPLE_JWT, FAKE_PUBLIC_KEY)
    expect(out.finding).toContain('confusion')
  })

  test('token_preview is included', () => {
    const out = actionAlgConfusion(SAMPLE_JWT, FAKE_PUBLIC_KEY)
    expect(out.token_preview).toBeDefined()
    expect(out.token_preview!.length).toBeGreaterThan(0)
  })

  test('action field is alg_confusion', () => {
    const out = actionAlgConfusion(SAMPLE_JWT)
    expect(out.action).toBe('alg_confusion')
  })
})

// =============================================================================
// kid header inspection tests (path traversal + SQL injection attacks)
// =============================================================================

describe('JWTTool — kid header attack patterns', () => {
  test('decode reveals kid header when present in JWT', () => {
    // Create a JWT with a kid header for testing
    const kidHeader = b64urlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'key-1', typ: 'JWT' })))
    const payload = b64urlEncode(Buffer.from(JSON.stringify({ sub: '123', role: 'user' })))
    const jwtWithKid = `${kidHeader}.${payload}.fakesig`

    const out = actionDecode(jwtWithKid)
    expect(out.header).toBeDefined()
    // The kid header should be visible in the decoded header
    expect(JSON.stringify(out.header)).toContain('kid')
  })

  test('path traversal kid attack: forge with empty secret (kid pointing to /dev/null)', () => {
    // kid: "../../dev/null" → server uses /dev/null as key file → empty string secret → forge with ""
    // Verify that forge with empty secret creates a valid-looking token structure
    const out = actionForge(SAMPLE_JWT, '{"role":"admin"}', '')
    expect(out.action).toBe('forge')
    expect(out.forged_token).toBeDefined()
    expect(out.forged_token!.split('.').length).toBe(3) // valid JWT structure
  })
})
