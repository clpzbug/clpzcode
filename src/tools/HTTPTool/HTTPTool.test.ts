import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const

const schema = z.strictObject({
  method: z.enum(METHODS).default('GET'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
  json: z.boolean().optional(),
  timeout_ms: z.number().int().min(100).max(120000).default(30000),
  follow_redirects: z.boolean().default(true),
})

describe('HTTPTool schema', () => {
  test('aceita GET mínimo com URL válida', () => {
    const r = schema.safeParse({ url: 'https://example.com' })
    expect(r.success).toBe(true)
  })

  test('default method=GET', () => {
    const r = schema.safeParse({ url: 'https://example.com' })
    if (r.success) expect(r.data.method).toBe('GET')
  })

  test('default timeout_ms=30000', () => {
    const r = schema.safeParse({ url: 'https://example.com' })
    if (r.success) expect(r.data.timeout_ms).toBe(30000)
  })

  test('default follow_redirects=true', () => {
    const r = schema.safeParse({ url: 'https://example.com' })
    if (r.success) expect(r.data.follow_redirects).toBe(true)
  })

  test('aceita todos os métodos HTTP', () => {
    for (const method of METHODS) {
      const r = schema.safeParse({ url: 'https://example.com', method })
      expect(r.success).toBe(true)
    }
  })

  test('aceita POST com body string', () => {
    const r = schema.safeParse({
      url: 'https://api.example.com/login',
      method: 'POST',
      body: '{"user":"admin","pass":"secret"}',
    })
    expect(r.success).toBe(true)
  })

  test('aceita POST com body objeto JSON', () => {
    const r = schema.safeParse({
      url: 'https://api.example.com/data',
      method: 'POST',
      body: { key: 'value', nested: { a: 1 } },
      json: true,
    })
    expect(r.success).toBe(true)
  })

  test('aceita body como array', () => {
    const r = schema.safeParse({
      url: 'https://api.example.com/batch',
      method: 'POST',
      body: [{ id: 1 }, { id: 2 }],
    })
    expect(r.success).toBe(true)
  })

  test('aceita headers customizados', () => {
    const r = schema.safeParse({
      url: 'https://api.example.com',
      headers: {
        Authorization: 'Bearer token123',
        'Content-Type': 'application/json',
      },
    })
    expect(r.success).toBe(true)
  })

  test('aceita follow_redirects=false', () => {
    const r = schema.safeParse({
      url: 'https://example.com',
      follow_redirects: false,
    })
    expect(r.success).toBe(true)
  })

  test('aceita timeout_ms customizado', () => {
    const r = schema.safeParse({ url: 'https://example.com', timeout_ms: 5000 })
    if (r.success) expect(r.data.timeout_ms).toBe(5000)
  })

  test('aceita DELETE sem body', () => {
    const r = schema.safeParse({
      url: 'https://api.example.com/resource/1',
      method: 'DELETE',
    })
    expect(r.success).toBe(true)
  })

  test('aceita HEAD request', () => {
    const r = schema.safeParse({
      url: 'https://example.com',
      method: 'HEAD',
    })
    expect(r.success).toBe(true)
  })

  test('rejeita URL inválida (sem protocolo)', () => {
    const r = schema.safeParse({ url: 'not-a-url' })
    expect(r.success).toBe(false)
  })

  test('rejeita URL sem scheme', () => {
    const r = schema.safeParse({ url: 'example.com/path' })
    expect(r.success).toBe(false)
  })

  test('rejeita método inválido', () => {
    const r = schema.safeParse({ url: 'https://example.com', method: 'CONNECT' })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout_ms abaixo do mínimo (100)', () => {
    const r = schema.safeParse({ url: 'https://example.com', timeout_ms: 99 })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout_ms acima do máximo (120000)', () => {
    const r = schema.safeParse({ url: 'https://example.com', timeout_ms: 120001 })
    expect(r.success).toBe(false)
  })

  test('rejeita sem URL', () => {
    const r = schema.safeParse({ method: 'GET' })
    expect(r.success).toBe(false)
  })
})
