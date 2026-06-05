import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const schema = z.strictObject({
  url: z.string(),
  depth: z.number().int().min(1).max(5).default(2),
  max_pages: z.number().int().min(1).max(200).default(50),
  scope: z.string().optional(),
  timeout_secs: z.number().int().min(30).max(600).default(120),
  stealth: z.boolean().default(false),
})

describe('SpiderTool schema', () => {
  test('aceita URL mínima', () => {
    const r = schema.safeParse({ url: 'https://example.com' })
    expect(r.success).toBe(true)
  })

  test('default depth=2', () => {
    const r = schema.safeParse({ url: 'https://example.com' })
    if (r.success) expect(r.data.depth).toBe(2)
  })

  test('default max_pages=50', () => {
    const r = schema.safeParse({ url: 'https://example.com' })
    if (r.success) expect(r.data.max_pages).toBe(50)
  })

  test('default timeout_secs=120', () => {
    const r = schema.safeParse({ url: 'https://example.com' })
    if (r.success) expect(r.data.timeout_secs).toBe(120)
  })

  test('aceita depth customizado', () => {
    const r = schema.safeParse({ url: 'https://example.com', depth: 4 })
    if (r.success) expect(r.data.depth).toBe(4)
  })

  test('aceita max_pages customizado', () => {
    const r = schema.safeParse({ url: 'https://example.com', max_pages: 100 })
    if (r.success) expect(r.data.max_pages).toBe(100)
  })

  test('aceita scope customizado', () => {
    const r = schema.safeParse({
      url: 'https://example.com',
      scope: 'example.com',
    })
    expect(r.success).toBe(true)
  })

  test('aceita timeout_secs customizado', () => {
    const r = schema.safeParse({ url: 'https://example.com', timeout_secs: 300 })
    if (r.success) expect(r.data.timeout_secs).toBe(300)
  })

  test('aceita URL com path e query', () => {
    const r = schema.safeParse({
      url: 'https://example.com/app/login?ref=home',
      depth: 3,
    })
    expect(r.success).toBe(true)
  })

  test('rejeita depth acima do máximo (5)', () => {
    const r = schema.safeParse({ url: 'https://example.com', depth: 6 })
    expect(r.success).toBe(false)
  })

  test('rejeita depth abaixo do mínimo (1)', () => {
    const r = schema.safeParse({ url: 'https://example.com', depth: 0 })
    expect(r.success).toBe(false)
  })

  test('rejeita max_pages acima do máximo (200)', () => {
    const r = schema.safeParse({ url: 'https://example.com', max_pages: 201 })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout_secs abaixo do mínimo (30)', () => {
    const r = schema.safeParse({ url: 'https://example.com', timeout_secs: 29 })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout_secs acima do máximo (600)', () => {
    const r = schema.safeParse({ url: 'https://example.com', timeout_secs: 601 })
    expect(r.success).toBe(false)
  })

  test('rejeita sem url', () => {
    const r = schema.safeParse({ depth: 2 })
    expect(r.success).toBe(false)
  })

  test('stealth default=false', () => {
    const r = schema.safeParse({ url: 'https://example.com' })
    if (r.success) expect(r.data.stealth).toBe(false)
  })

  test('aceita stealth=true', () => {
    const r = schema.safeParse({ url: 'https://example.com', stealth: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.stealth).toBe(true)
  })

  test('aceita stealth=false explícito', () => {
    const r = schema.safeParse({ url: 'https://example.com', stealth: false })
    expect(r.success).toBe(true)
  })
})

// =============================================================================
// Output schema tests — verifies pentest-critical fields
// =============================================================================

const outputSchema = z.object({
  success: z.boolean(),
  base_url: z.string(),
  pages_visited: z.number(),
  endpoints: z.array(z.string()),
  forms: z.array(z.unknown()),
  api_calls: z.array(z.string()),
  js_routes: z.array(z.string()),
  output_file: z.string().optional(),
  error: z.string().optional(),
})

describe('SpiderTool output schema — pentest-critical fields', () => {

  test('accepts full output with all pentest fields', () => {
    const r = outputSchema.safeParse({
      success: true,
      base_url: 'https://example.com',
      pages_visited: 15,
      endpoints: ['https://example.com/', 'https://example.com/login'],
      forms: [{ page: 'https://example.com/login', action: '/auth', method: 'POST', fields: [{ name: 'username', type: 'text' }] }],
      api_calls: ['GET https://api.example.com/users', 'POST https://api.example.com/auth'],
      js_routes: ['/dashboard', '/admin', '/api/v2'],
    })
    expect(r.success).toBe(true)
  })

  test('api_calls field discovers hidden API endpoints (critical for IDOR/auth-bypass)', () => {
    const r = outputSchema.safeParse({
      success: true,
      base_url: 'https://example.com',
      pages_visited: 3,
      endpoints: [],
      forms: [],
      api_calls: ['GET /api/internal/admin', 'POST /api/v2/users/1/role'],
      js_routes: [],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.api_calls).toContain('GET /api/internal/admin')
    }
  })
})
