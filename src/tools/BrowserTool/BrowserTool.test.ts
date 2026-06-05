import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const ACTIONS = [
  'navigate', 'click', 'fill', 'select',
  'screenshot', 'evaluate', 'wait', 'extract', 'close',
] as const

const schema = z.strictObject({
  action: z.enum(ACTIONS),
  url: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  script: z.string().optional(),
  wait_for: z.union([z.string(), z.number()]).optional(),
  full_page: z.boolean().default(false),
  timeout_ms: z.number().int().min(100).max(60000).default(10000),
  stealth: z.boolean().default(false),
  proxy: z.string().optional(),
})

describe('BrowserTool schema', () => {
  test('aceita navigate com URL', () => {
    const r = schema.safeParse({
      action: 'navigate',
      url: 'https://example.com',
    })
    expect(r.success).toBe(true)
  })

  test('default full_page=false e timeout_ms=10000', () => {
    const r = schema.safeParse({ action: 'navigate', url: 'https://example.com' })
    if (r.success) {
      expect(r.data.full_page).toBe(false)
      expect(r.data.timeout_ms).toBe(10000)
    }
  })

  test('aceita click com selector', () => {
    const r = schema.safeParse({ action: 'click', selector: '#submit-btn' })
    expect(r.success).toBe(true)
  })

  test('aceita fill com selector e text', () => {
    const r = schema.safeParse({
      action: 'fill',
      selector: 'input[name="username"]',
      text: 'admin',
    })
    expect(r.success).toBe(true)
  })

  test('aceita select com selector e text (option)', () => {
    const r = schema.safeParse({
      action: 'select',
      selector: 'select#country',
      text: 'Brazil',
    })
    expect(r.success).toBe(true)
  })

  test('aceita screenshot com full_page=true', () => {
    const r = schema.safeParse({ action: 'screenshot', full_page: true })
    if (r.success) expect(r.data.full_page).toBe(true)
  })

  test('aceita evaluate com script', () => {
    const r = schema.safeParse({
      action: 'evaluate',
      script: 'document.title',
    })
    expect(r.success).toBe(true)
  })

  test('aceita wait com selector CSS', () => {
    const r = schema.safeParse({
      action: 'wait',
      wait_for: '.loading-done',
    })
    expect(r.success).toBe(true)
  })

  test('aceita wait com timeout numérico (ms)', () => {
    const r = schema.safeParse({ action: 'wait', wait_for: 2000 })
    expect(r.success).toBe(true)
  })

  test('aceita extract com selector', () => {
    const r = schema.safeParse({
      action: 'extract',
      selector: '.product-price',
    })
    expect(r.success).toBe(true)
  })

  test('aceita close sem parâmetros', () => {
    const r = schema.safeParse({ action: 'close' })
    expect(r.success).toBe(true)
  })

  test('aceita navigate com wait_for CSS selector', () => {
    const r = schema.safeParse({
      action: 'navigate',
      url: 'https://example.com/app',
      wait_for: '#app-loaded',
    })
    expect(r.success).toBe(true)
  })

  test('aceita todas as actions', () => {
    for (const action of ACTIONS) {
      const r = schema.safeParse({ action })
      expect(r.success).toBe(true)
    }
  })

  test('aceita timeout_ms customizado', () => {
    const r = schema.safeParse({ action: 'click', selector: '#btn', timeout_ms: 30000 })
    if (r.success) expect(r.data.timeout_ms).toBe(30000)
  })

  test('rejeita sem action', () => {
    const r = schema.safeParse({ url: 'https://example.com' })
    expect(r.success).toBe(false)
  })

  test('rejeita action inválida', () => {
    const r = schema.safeParse({ action: 'scroll' })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout_ms abaixo do mínimo (100)', () => {
    const r = schema.safeParse({ action: 'click', selector: '#btn', timeout_ms: 99 })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout_ms acima do máximo (60000)', () => {
    const r = schema.safeParse({ action: 'click', selector: '#btn', timeout_ms: 60001 })
    expect(r.success).toBe(false)
  })

  test('stealth default=false', () => {
    const r = schema.safeParse({ action: 'navigate', url: 'https://example.com' })
    if (r.success) expect(r.data.stealth).toBe(false)
  })

  test('aceita stealth=true', () => {
    const r = schema.safeParse({ action: 'navigate', url: 'https://example.com', stealth: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.stealth).toBe(true)
  })

  test('aceita proxy string', () => {
    const r = schema.safeParse({
      action: 'navigate',
      url: 'https://example.com',
      stealth: true,
      proxy: 'http://user:pass@proxy.example.com:8080',
    })
    expect(r.success).toBe(true)
  })

  test('proxy é opcional (undefined por default)', () => {
    const r = schema.safeParse({ action: 'navigate', url: 'https://example.com' })
    if (r.success) expect(r.data.proxy).toBeUndefined()
  })
})
