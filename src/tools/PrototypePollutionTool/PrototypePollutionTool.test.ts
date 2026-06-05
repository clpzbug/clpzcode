import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { __test } from './PrototypePollutionTool.js'

const { GADGETS } = __test

const ACTIONS = ['server_side', 'client_side', 'gadget_check', 'full'] as const

const schema = z.strictObject({
  url: z.string(),
  action: z.enum(ACTIONS),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string(), z.string()).optional(),
  timeout_secs: z.number().int().min(5).max(300).default(30),
})

describe('PrototypePollutionTool schema', () => {
  test('accepts server_side action', () => {
    const r = schema.safeParse({ url: 'https://example.com/api', action: 'server_side' })
    expect(r.success).toBe(true)
  })

  test('accepts client_side action', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'client_side' })
    expect(r.success).toBe(true)
  })

  test('accepts gadget_check action', () => {
    const r = schema.safeParse({ url: 'https://example.com/api', action: 'gadget_check' })
    expect(r.success).toBe(true)
  })

  test('accepts full action', () => {
    const r = schema.safeParse({ url: 'https://example.com/api', action: 'full' })
    expect(r.success).toBe(true)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ action: 'server_side' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'xss' })
    expect(r.success).toBe(false)
  })

  test('defaults method to POST', () => {
    const r = schema.safeParse({ url: 'https://example.com/api', action: 'server_side' })
    if (r.success) expect(r.data.method).toBe('POST')
  })

  test('accepts PATCH method', () => {
    const r = schema.safeParse({ url: 'https://example.com/api', action: 'server_side', method: 'PATCH' })
    expect(r.success).toBe(true)
  })

  test('rejects invalid method', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'server_side', method: 'DELETE' })
    expect(r.success).toBe(false)
  })

  test('defaults timeout_secs to 30', () => {
    const r = schema.safeParse({ url: 'https://example.com/api', action: 'full' })
    if (r.success) expect(r.data.timeout_secs).toBe(30)
  })
})

// =============================================================================
// GADGETS — framework PP→RCE gadget coverage
// =============================================================================

describe('PrototypePollution GADGETS', () => {
  test('includes EJS RCE gadget(s)', () => {
    expect(GADGETS.some(g => g.name.toLowerCase().includes('ejs'))).toBe(true)
  })

  test('includes a Pug RCE gadget', () => {
    expect(GADGETS.some(g => g.name.toLowerCase().includes('pug'))).toBe(true)
  })

  test('all gadgets pollute via __proto__', () => {
    for (const g of GADGETS) expect(g.payload).toContain('__proto__')
  })

  test('no gadget uses destructive process.exit (detection must be benign)', () => {
    for (const g of GADGETS) expect(g.payload).not.toContain('process.exit')
  })

  test('covers at least 6 gadgets across multiple frameworks', () => {
    // express-fileupload, lodash isAdmin, ejs outputFunctionName, ejs client/escape,
    // pug block.Text, Handlebars AST injection = 6 total
    expect(GADGETS.length).toBeGreaterThanOrEqual(6)
  })

  test('includes lodash isAdmin privilege escalation gadget', () => {
    expect(GADGETS.some(g => g.name.toLowerCase().includes('isadmin') || g.name.toLowerCase().includes('lodash'))).toBe(true)
  })

  test('ejs outputFunctionName payload contains execSync', () => {
    const ejsGadget = GADGETS.find(g => g.name.includes('outputFunctionName'))
    expect(ejsGadget).toBeDefined()
    expect(ejsGadget!.payload).toContain('execSync')
  })

  test('all payloads are valid JSON strings', () => {
    for (const g of GADGETS) {
      expect(() => JSON.parse(g.payload)).not.toThrow()
    }
  })
})

// =============================================================================
// PrototypePollutionTool pentest escalation tests
// =============================================================================

describe('PrototypePollutionTool — pentest escalation scenarios', () => {
  test('gadget_check accepted for immediate RCE after detection', () => {
    const r = schema.safeParse({
      url: 'https://target.com/api/merge',
      action: 'gadget_check',
    })
    expect(r.success).toBe(true)
  })

  test('server_side + gadget_check together as full action', () => {
    const r = schema.safeParse({
      url: 'https://target.com/api',
      action: 'full',
      method: 'POST',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.action).toBe('full')
  })

  test('Handlebars gadget is in GADGETS list (cycle 3 addition)', () => {
    const handlebars = GADGETS.find(g => g.name.toLowerCase().includes('handlebars'))
    expect(handlebars).toBeDefined()
  })

  test('all gadget payloads target __proto__ or constructor.prototype', () => {
    for (const g of GADGETS) {
      const payload = JSON.parse(g.payload)
      const hasProto = '__proto__' in payload || 'constructor' in payload
      expect(hasProto).toBe(true)
    }
  })
})
