import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const schema = z.strictObject({
  bug_class: z.string(),
  target_url: z.string().optional(),
})

const KNOWN_BUG_CLASSES = [
  // Web / app
  'open-redirect', 'ssrf-blind', 'ssrf', 'stored-xss', 'reflected-xss',
  'idor-read', 'cors-wildcard', 'cors-credentialed', 'path-traversal',
  'sqli', 'ssti', 'file-upload', 'lfi', 'command-injection', 'deserialization',
  'jwt-weak-secret', 'graphql', 'wordpress', 'csrf', 'xxe',
  'subdomain-takeover', 'race-condition',
  // Active Directory
  'kerberoast', 'asreproast', 'adcs-esc1', 'ntlm-relay',
  'coerce', 'bloodhound-path', 'zerologon',
] as const

describe('ChainTool schema', () => {
  test('accepts bug_class only', () => {
    const r = schema.safeParse({ bug_class: 'sqli' })
    expect(r.success).toBe(true)
  })

  test('accepts bug_class with target_url', () => {
    const r = schema.safeParse({ bug_class: 'ssrf', target_url: 'https://target.com/fetch' })
    expect(r.success).toBe(true)
  })

  test('rejects missing bug_class', () => {
    const r = schema.safeParse({ target_url: 'https://target.com' })
    expect(r.success).toBe(false)
  })

  test('accepts all known bug classes', () => {
    for (const cls of KNOWN_BUG_CLASSES) {
      const r = schema.safeParse({ bug_class: cls })
      expect(r.success).toBe(true)
    }
  })

  test('bug_class is a string (accepts unknown classes)', () => {
    const r = schema.safeParse({ bug_class: 'custom-vuln-class' })
    expect(r.success).toBe(true)
  })

  test('target_url is optional', () => {
    const r = schema.safeParse({ bug_class: 'open-redirect' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.target_url).toBeUndefined()
  })

  test('accepts AD-related bug classes', () => {
    const r1 = schema.safeParse({ bug_class: 'kerberoast' })
    const r2 = schema.safeParse({ bug_class: 'adcs-esc1' })
    const r3 = schema.safeParse({ bug_class: 'zerologon' })
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(r3.success).toBe(true)
  })

  test('known bug classes count is 29', () => {
    expect(KNOWN_BUG_CLASSES.length).toBe(29)
  })

  test('accepts web vuln classes', () => {
    const r1 = schema.safeParse({ bug_class: 'stored-xss' })
    const r2 = schema.safeParse({ bug_class: 'path-traversal' })
    const r3 = schema.safeParse({ bug_class: 'cors-wildcard' })
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(r3.success).toBe(true)
  })

  test('accepts new critical-path chains added in pentest cycle 2', () => {
    const newChains = [
      'deserialization', 'lfi', 'command-injection',
      'jwt-weak-secret', 'graphql', 'wordpress', 'cors-credentialed',
    ]
    for (const cls of newChains) {
      const r = schema.safeParse({ bug_class: cls })
      expect(r.success).toBe(true)
    }
  })

  test('accepts new chains added in pentest cycle 3 (csrf, xxe)', () => {
    const r1 = schema.safeParse({ bug_class: 'csrf' })
    const r2 = schema.safeParse({ bug_class: 'xxe' })
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
  })

  test('accepts subdomain-takeover chain (bug bounty staple)', () => {
    const r = schema.safeParse({ bug_class: 'subdomain-takeover' })
    expect(r.success).toBe(true)
  })

  test('accepts race-condition chain (TOCTOU exploitation)', () => {
    const r = schema.safeParse({ bug_class: 'race-condition' })
    expect(r.success).toBe(true)
  })

  test('preserves target_url in parsed output', () => {
    const url = 'https://example.com/api?id=1'
    const r = schema.safeParse({ bug_class: 'idor-read', target_url: url })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.target_url).toBe(url)
  })
})

describe('ChainTool — cycle 4 new chain classes', () => {
  test('accepts wordpress chain class', () => {
    const r = schema.safeParse({ bug_class: 'wordpress' })
    expect(r.success).toBe(true)
  })

  test('accepts xxe chain class', () => {
    const r = schema.safeParse({ bug_class: 'xxe' })
    expect(r.success).toBe(true)
  })

  test('accepts csrf chain class', () => {
    const r = schema.safeParse({ bug_class: 'csrf' })
    expect(r.success).toBe(true)
  })

  test('accepts cors-credentialed chain class (ACAC:true → account takeover)', () => {
    const r = schema.safeParse({ bug_class: 'cors-credentialed' })
    expect(r.success).toBe(true)
  })

  test('accepts subdomain-takeover chain class', () => {
    const r = schema.safeParse({ bug_class: 'subdomain-takeover' })
    expect(r.success).toBe(true)
  })

  test('chain class accepts full URL with path for context', () => {
    const r = schema.safeParse({
      bug_class: 'ssti',
      target_url: 'https://target.com/search?q=test&category=news',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.target_url).toContain('?q=test')
  })
})
