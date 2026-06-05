import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const ACTIONS = ['introspect', 'batch', 'inject', 'suggest', 'dos', 'info', 'persisted'] as const

const schema = z.strictObject({
  url: z.string(),
  action: z.enum(ACTIONS),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.string().optional(),
  field: z.string().optional(),
  timeout_secs: z.number().int().min(5).max(300).default(30),
})

describe('GraphQLTool schema', () => {
  test('accepts introspect action', () => {
    const r = schema.safeParse({ url: 'https://example.com/graphql', action: 'introspect' })
    expect(r.success).toBe(true)
  })

  test('accepts batch action', () => {
    const r = schema.safeParse({ url: 'https://example.com/graphql', action: 'batch' })
    expect(r.success).toBe(true)
  })

  test('accepts inject action with custom query', () => {
    const r = schema.safeParse({
      url: 'https://example.com/graphql',
      action: 'inject',
      query: '{ user(id: "1 OR 1=1") { id } }',
    })
    expect(r.success).toBe(true)
  })

  test('accepts suggest action with field', () => {
    const r = schema.safeParse({ url: 'https://example.com/graphql', action: 'suggest', field: 'user' })
    expect(r.success).toBe(true)
  })

  test('accepts dos action', () => {
    const r = schema.safeParse({ url: 'https://example.com/graphql', action: 'dos' })
    expect(r.success).toBe(true)
  })

  test('accepts info action', () => {
    const r = schema.safeParse({ url: 'https://example.com/graphql', action: 'info' })
    expect(r.success).toBe(true)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ action: 'introspect' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ url: 'https://example.com/graphql', action: 'xss' })
    expect(r.success).toBe(false)
  })

  test('defaults timeout_secs to 30', () => {
    const r = schema.safeParse({ url: 'https://example.com/graphql', action: 'introspect' })
    if (r.success) expect(r.data.timeout_secs).toBe(30)
  })

  test('accepts Authorization header', () => {
    const r = schema.safeParse({
      url: 'https://example.com/graphql',
      action: 'introspect',
      headers: { Authorization: 'Bearer secret' },
    })
    expect(r.success).toBe(true)
  })

  test('accepts persisted (APQ) action', () => {
    const r = schema.safeParse({ url: 'https://example.com/graphql', action: 'persisted' })
    expect(r.success).toBe(true)
  })
})

// =============================================================================
// GraphQL pentest scenario tests
// =============================================================================

describe('GraphQLTool — pentest scenarios', () => {
  test('batch query accepted with custom GraphQL endpoint', () => {
    const r = schema.safeParse({
      url: 'https://api.target.com/graphql',
      action: 'batch',
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9...' },
    })
    expect(r.success).toBe(true)
  })

  test('inject with custom query for IDOR testing', () => {
    const r = schema.safeParse({
      url: 'https://target.com/graphql',
      action: 'inject',
      query: '{ user(id: "2") { id name email } }',
    })
    expect(r.success).toBe(true)
  })

  test('suggest with field name for hidden admin mutation discovery', () => {
    const r = schema.safeParse({
      url: 'https://target.com/graphql',
      action: 'suggest',
      field: 'admin',
    })
    expect(r.success).toBe(true)
  })

  test('persisted APQ detection is a valid action', () => {
    const r = schema.safeParse({ url: 'https://target.com/graphql', action: 'persisted' })
    expect(r.success).toBe(true)
  })
})

describe('GraphQLTool — advanced pentest escalation scenarios (cycle 4)', () => {
  test('introspect with auth token for post-auth schema enumeration', () => {
    const r = schema.safeParse({
      url: 'https://api.target.com/graphql',
      action: 'introspect',
      headers: {
        Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.test',
        'Content-Type': 'application/json',
      },
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.headers?.['Authorization']).toContain('Bearer')
  })

  test('inject action with SQLi payload in GraphQL resolver argument', () => {
    const r = schema.safeParse({
      url: 'https://api.target.com/graphql',
      action: 'inject',
      query: '{ user(id: "1 UNION SELECT 1,2,username,password FROM users--") { id name email } }',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.query).toContain('UNION SELECT')
  })

  test('dos action with max timeout for deep nesting abuse', () => {
    const r = schema.safeParse({
      url: 'https://api.target.com/graphql',
      action: 'dos',
      timeout_secs: 300,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.timeout_secs).toBe(300)
  })

  test('suggest with admin field name to discover hidden admin mutations', () => {
    const r = schema.safeParse({
      url: 'https://api.target.com/graphql',
      action: 'suggest',
      field: 'deleteUser',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.field).toBe('deleteUser')
  })
})
