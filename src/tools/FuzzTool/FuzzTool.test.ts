import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'] as const

const schema = z.strictObject({
  url: z.string(),
  wordlist: z.string().default('common'),
  extensions: z.array(z.string()).optional(),
  method: z.enum(HTTP_METHODS).default('GET'),
  data: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  filter_status: z.array(z.number().int()).default([404]),
  match_status: z.array(z.number().int()).optional(),
  filter_size: z.array(z.number().int()).optional(),
  threads: z.number().int().min(1).max(200).default(40),
  timeout_secs: z.number().int().min(10).max(3600).default(300),
})

describe('FuzzTool schema', () => {
  test('accepts minimal input with FUZZ url', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ', wordlist: 'common', method: 'GET', filter_status: [404], threads: 40, timeout_secs: 300 })
    expect(r.success).toBe(true)
  })

  test('defaults method to GET', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.method).toBe('GET')
  })

  test('defaults wordlist to common', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.wordlist).toBe('common')
  })

  test('defaults filter_status to [404]', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.filter_status).toEqual([404])
  })

  test('defaults threads to 40', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.threads).toBe(40)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ wordlist: 'common' })
    expect(r.success).toBe(false)
  })

  test('accepts extensions array', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ', extensions: ['.php', '.html'] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.extensions).toEqual(['.php', '.html'])
  })

  test('rejects threads above maximum', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ', threads: 999 })
    expect(r.success).toBe(false)
  })

  test('accepts match_status filter', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ', match_status: [200, 301] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.match_status).toEqual([200, 301])
  })

  test('accepts POST method with data', () => {
    const r = schema.safeParse({ url: 'http://target/api', method: 'POST', data: 'username=FUZZ&pass=test' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.method).toBe('POST')
  })

  // Security-specific wordlist shortcuts
  test('accepts lfi wordlist shortcut (path traversal payloads)', () => {
    const r = schema.safeParse({ url: 'http://target/page?file=FUZZ', wordlist: 'lfi' })
    expect(r.success).toBe(true)
  })

  test('accepts backups wordlist shortcut (database backup discovery)', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ', wordlist: 'backups' })
    expect(r.success).toBe(true)
  })

  test('accepts command-injection wordlist shortcut', () => {
    const r = schema.safeParse({ url: 'http://target/api?cmd=FUZZ', wordlist: 'command-injection' })
    expect(r.success).toBe(true)
  })

  test('accepts graphql wordlist shortcut (GraphQL endpoint discovery)', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ', wordlist: 'graphql' })
    expect(r.success).toBe(true)
  })

  test('accepts subdomains wordlist shortcut (upgraded to 20k entries)', () => {
    const r = schema.safeParse({ url: 'http://FUZZ.target.com/', wordlist: 'subdomains' })
    expect(r.success).toBe(true)
  })

  test('accepts raft wordlist shortcut (real-world file names)', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ', wordlist: 'raft' })
    expect(r.success).toBe(true)
  })

  test('accepts xss-poly wordlist shortcut (XSS polyglots)', () => {
    const r = schema.safeParse({ url: 'http://target/search?q=FUZZ', wordlist: 'xss-poly' })
    expect(r.success).toBe(true)
  })
})

  // New SSTI and SQLi wordlists (cycle 3)
  test('accepts ssti wordlist shortcut (template engine expressions)', () => {
    const r = schema.safeParse({ url: 'http://target/search?q=FUZZ', wordlist: 'ssti' })
    expect(r.success).toBe(true)
  })

  test('accepts ssti-vars wordlist shortcut (special template variables)', () => {
    const r = schema.safeParse({ url: 'http://target/render?name=FUZZ', wordlist: 'ssti-vars' })
    expect(r.success).toBe(true)
  })

  test('accepts sqli-blind wordlist shortcut (MySQL file read payloads)', () => {
    const r = schema.safeParse({ url: 'http://target/page?id=FUZZ', wordlist: 'sqli-blind' })
    expect(r.success).toBe(true)
  })

describe('FuzzTool — new wordlist shortcuts (cycle 4)', () => {
  test('accepts secrets wordlist shortcut', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ', wordlist: 'secrets' })
    expect(r.success).toBe(true)
  })

  test('accepts spring-actuator wordlist shortcut', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ', wordlist: 'spring-actuator' })
    expect(r.success).toBe(true)
  })

  test('accepts wordpress wordlist shortcut', () => {
    const r = schema.safeParse({ url: 'http://target/FUZZ', wordlist: 'wordpress' })
    expect(r.success).toBe(true)
  })
})
