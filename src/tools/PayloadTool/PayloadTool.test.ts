import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const schema = z.strictObject({
  operation: z.enum(['list', 'get', 'search']).default('list'),
  category: z.string().optional(),
  query: z.string().optional(),
  max_lines: z.number().int().min(10).max(2000).default(500),
})

describe('PayloadTool schema', () => {
  test('accepts list operation', () => {
    const r = schema.safeParse({ operation: 'list' })
    expect(r.success).toBe(true)
  })

  test('accepts get with category', () => {
    const r = schema.safeParse({ operation: 'get', category: 'SQL Injection' })
    expect(r.success).toBe(true)
  })

  test('accepts search with query', () => {
    const r = schema.safeParse({ operation: 'search', query: 'union select' })
    expect(r.success).toBe(true)
  })

  test('defaults operation to list', () => {
    const r = schema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.operation).toBe('list')
  })

  test('defaults max_lines to 500', () => {
    const r = schema.safeParse({ operation: 'list' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.max_lines).toBe(500)
  })

  test('rejects invalid operation', () => {
    const r = schema.safeParse({ operation: 'execute' })
    expect(r.success).toBe(false)
  })

  test('rejects max_lines below minimum', () => {
    const r = schema.safeParse({ operation: 'list', max_lines: 5 })
    expect(r.success).toBe(false)
  })

  test('rejects max_lines above maximum', () => {
    const r = schema.safeParse({ operation: 'get', category: 'XSS', max_lines: 9999 })
    expect(r.success).toBe(false)
  })

  test('accepts max_lines at boundary values', () => {
    const r10 = schema.safeParse({ operation: 'list', max_lines: 10 })
    const r2000 = schema.safeParse({ operation: 'list', max_lines: 2000 })
    expect(r10.success).toBe(true)
    expect(r2000.success).toBe(true)
  })

  test('category and query are optional', () => {
    const r = schema.safeParse({ operation: 'list' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.category).toBeUndefined()
      expect(r.data.query).toBeUndefined()
    }
  })

  // Pentest-specific category lookups (from our updated prompt)
  test('accepts SSTI category name (from PayloadsAllTheThings)', () => {
    const r = schema.safeParse({ operation: 'get', category: 'Server Side Template Injection' })
    expect(r.success).toBe(true)
  })

  test('accepts deserialization category name', () => {
    const r = schema.safeParse({ operation: 'get', category: 'Insecure Deserialization' })
    expect(r.success).toBe(true)
  })

  test('accepts file upload category name', () => {
    const r = schema.safeParse({ operation: 'get', category: 'Upload Insecure Files' })
    expect(r.success).toBe(true)
  })

  test('accepts LFI category name', () => {
    const r = schema.safeParse({ operation: 'get', category: 'File Inclusion' })
    expect(r.success).toBe(true)
  })

  test('accepts JWT category name', () => {
    const r = schema.safeParse({ operation: 'get', category: 'JSON Web Token' })
    expect(r.success).toBe(true)
  })

  test('accepts ysoserial search query (deserialization research)', () => {
    const r = schema.safeParse({ operation: 'search', query: 'ysoserial CommonsCollections' })
    expect(r.success).toBe(true)
  })

  test('accepts log poisoning search query (LFI→RCE)', () => {
    const r = schema.safeParse({ operation: 'search', query: 'log poisoning' })
    expect(r.success).toBe(true)
  })
})
