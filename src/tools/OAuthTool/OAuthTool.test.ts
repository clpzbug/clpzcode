import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { __test } from './OAuthTool.js'

const { buildAuthUrl } = __test

const ACTIONS = ['token_leak', 'state_bypass', 'redirect_uri', 'implicit_flow', 'pkce_check', 'token_reuse'] as const

const schema = z.strictObject({
  authorization_url: z.string(),
  action: z.enum(ACTIONS),
  token_url: z.string().optional(),
  client_id: z.string().optional(),
  redirect_uri: z.string().optional(),
  scope: z.string().optional().default('openid profile email'),
  extra_params: z.record(z.string(), z.string()).optional(),
  timeout_secs: z.number().int().min(5).max(300).default(30),
})

describe('OAuthTool schema', () => {
  test('accepts token_leak action', () => {
    const r = schema.safeParse({ authorization_url: 'https://auth.example.com/authorize?client_id=abc', action: 'token_leak' })
    expect(r.success).toBe(true)
  })

  test('accepts state_bypass action', () => {
    const r = schema.safeParse({ authorization_url: 'https://auth.example.com/authorize', action: 'state_bypass' })
    expect(r.success).toBe(true)
  })

  test('accepts redirect_uri action with redirect_uri', () => {
    const r = schema.safeParse({
      authorization_url: 'https://auth.example.com/authorize',
      action: 'redirect_uri',
      redirect_uri: 'https://app.example.com/callback',
    })
    expect(r.success).toBe(true)
  })

  test('accepts implicit_flow action', () => {
    const r = schema.safeParse({ authorization_url: 'https://auth.example.com/authorize', action: 'implicit_flow' })
    expect(r.success).toBe(true)
  })

  test('accepts pkce_check with token_url', () => {
    const r = schema.safeParse({
      authorization_url: 'https://auth.example.com/authorize',
      action: 'pkce_check',
      token_url: 'https://auth.example.com/token',
    })
    expect(r.success).toBe(true)
  })

  test('accepts token_reuse action', () => {
    const r = schema.safeParse({ authorization_url: 'https://auth.example.com/authorize', action: 'token_reuse' })
    expect(r.success).toBe(true)
  })

  test('rejects missing authorization_url', () => {
    const r = schema.safeParse({ action: 'token_leak' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ authorization_url: 'https://auth.example.com/authorize', action: 'xss' })
    expect(r.success).toBe(false)
  })

  test('defaults scope', () => {
    const r = schema.safeParse({ authorization_url: 'https://auth.example.com/authorize', action: 'implicit_flow' })
    if (r.success) expect(r.data.scope).toBe('openid profile email')
  })

  test('defaults timeout_secs to 30', () => {
    const r = schema.safeParse({ authorization_url: 'https://auth.example.com/authorize', action: 'state_bypass' })
    if (r.success) expect(r.data.timeout_secs).toBe(30)
  })
})

// =============================================================================
// buildAuthUrl — query-param construction
// =============================================================================

describe('buildAuthUrl', () => {
  test('appends query params to a bare URL', () => {
    const u = buildAuthUrl('https://auth.example.com/authorize', { response_type: 'code', client_id: 'abc' })
    expect(u).toContain('response_type=code')
    expect(u).toContain('client_id=abc')
  })

  test('preserves and overrides existing query params', () => {
    const u = buildAuthUrl('https://auth.example.com/authorize?foo=bar', { foo: 'baz', x: '1' })
    // searchParams.set overrides foo, keeps the host/path
    expect(u).toContain('foo=baz')
    expect(u).toContain('x=1')
    expect(u).not.toContain('foo=bar')
  })

  test('URL-encodes parameter values', () => {
    const u = buildAuthUrl('https://auth.example.com/authorize', { redirect_uri: 'https://app/cb?a=b' })
    expect(u).toContain('redirect_uri=https%3A%2F%2Fapp%2Fcb%3Fa%3Db')
  })

  test('builds a PKCE downgrade (plain) authorization request', () => {
    const u = buildAuthUrl('https://auth.example.com/authorize', {
      response_type: 'code',
      code_challenge: 'clpzPlainChallenge123456789',
      code_challenge_method: 'plain',
    })
    expect(u).toContain('code_challenge_method=plain')
    expect(u).toContain('code_challenge=clpzPlainChallenge123456789')
  })
})

// =============================================================================
// Scope escalation — test extra_params for privilege escalation
// =============================================================================

describe('OAuthTool scope escalation via extra_params', () => {
  test('accepts extra_params for scope escalation testing', () => {
    const r = schema.safeParse({
      authorization_url: 'https://auth.example.com/authorize',
      action: 'token_leak',
      extra_params: { scope: 'admin openid profile' },
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.extra_params?.['scope']).toBe('admin openid profile')
  })

  test('accepts extra_params with offline_access scope', () => {
    const r = schema.safeParse({
      authorization_url: 'https://auth.example.com/authorize',
      action: 'implicit_flow',
      extra_params: { scope: 'openid offline_access admin' },
    })
    expect(r.success).toBe(true)
  })

  test('buildAuthUrl includes extra_params in URL', () => {
    const u = buildAuthUrl('https://auth.example.com/authorize', {
      response_type: 'code',
      client_id: 'test',
      scope: 'admin openid',
    })
    expect(u).toContain('scope=admin+openid')
  })
})
