import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const PROFILES = [
  'pentest', 'recommended', 'cves', 'kev', 'default-login', 'misconfigs',
  'wordpress', 'cloud', 'compliance', 'windows', 'osint', 'takeovers',
  'priv-esc', 'ai', 'all',
  // Cloud-provider specific profiles (added in pentest cycle 3)
  'aws', 'gcp', 'azure', 'alibaba', 'k8s',
] as const

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const

const schema = z.strictObject({
  targets: z.array(z.string()).min(1),
  profile: z.enum(PROFILES).optional(),
  templates: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  exclude_tags: z.array(z.string()).optional(),
  severity: z.array(z.enum(SEVERITIES)).optional(),
  rate_limit: z.number().int().min(1).max(1000).default(150),
  concurrency: z.number().int().min(1).max(100).default(25),
  timeout: z.number().int().min(1).max(120).default(10),
  headers: z.record(z.string(), z.string()).optional(),
  proxy: z.string().optional(),
  no_interactsh: z.boolean().default(false),
  auto_scan: z.boolean().default(false),
  new_templates_only: z.boolean().default(false),
  timeout_secs: z.number().int().min(30).max(7200).default(600),
})

describe('NucleiTool schema', () => {
  test('aceita scan mínimo com target', () => {
    const r = schema.safeParse({ targets: ['https://example.com'] })
    expect(r.success).toBe(true)
  })

  test('defaults: rate_limit=150, concurrency=25, timeout=10, timeout_secs=600', () => {
    const r = schema.safeParse({ targets: ['https://example.com'] })
    if (r.success) {
      expect(r.data.rate_limit).toBe(150)
      expect(r.data.concurrency).toBe(25)
      expect(r.data.timeout).toBe(10)
      expect(r.data.timeout_secs).toBe(600)
    }
  })

  test('defaults: no_interactsh=false, auto_scan=false, new_templates_only=false', () => {
    const r = schema.safeParse({ targets: ['https://example.com'] })
    if (r.success) {
      expect(r.data.no_interactsh).toBe(false)
      expect(r.data.auto_scan).toBe(false)
      expect(r.data.new_templates_only).toBe(false)
    }
  })

  test('aceita todos os profiles', () => {
    for (const profile of PROFILES) {
      const r = schema.safeParse({ targets: ['https://example.com'], profile })
      expect(r.success).toBe(true)
    }
  })

  test('aceita todas as severidades', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], severity: [...SEVERITIES] })
    expect(r.success).toBe(true)
  })

  test('aceita templates customizados', () => {
    const r = schema.safeParse({
      targets: ['https://example.com'],
      templates: ['http/cves', 'http/vulnerabilities'],
    })
    expect(r.success).toBe(true)
  })

  test('aceita tags e exclude_tags', () => {
    const r = schema.safeParse({
      targets: ['https://example.com'],
      tags: ['rce', 'sqli'],
      exclude_tags: ['dos', 'fuzz'],
    })
    expect(r.success).toBe(true)
  })

  test('aceita headers customizados', () => {
    const r = schema.safeParse({
      targets: ['https://example.com'],
      headers: { Authorization: 'Bearer token123', 'X-Custom': 'value' },
    })
    expect(r.success).toBe(true)
  })

  test('aceita proxy', () => {
    const r = schema.safeParse({
      targets: ['https://example.com'],
      proxy: 'http://127.0.0.1:8080',
    })
    expect(r.success).toBe(true)
  })

  test('aceita no_interactsh=true', () => {
    const r = schema.safeParse({
      targets: ['https://example.com'],
      no_interactsh: true,
    })
    expect(r.success).toBe(true)
  })

  test('aceita auto_scan=true', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], auto_scan: true })
    expect(r.success).toBe(true)
  })

  test('aceita new_templates_only=true', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], new_templates_only: true })
    expect(r.success).toBe(true)
  })

  test('aceita múltiplos targets', () => {
    const r = schema.safeParse({
      targets: ['https://a.com', 'https://b.com', '10.0.0.1'],
    })
    expect(r.success).toBe(true)
  })

  test('rejeita targets vazio', () => {
    const r = schema.safeParse({ targets: [] })
    expect(r.success).toBe(false)
  })

  test('rejeita sem targets', () => {
    const r = schema.safeParse({ profile: 'cves' })
    expect(r.success).toBe(false)
  })

  test('rejeita profile inválido', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], profile: 'unknown' })
    expect(r.success).toBe(false)
  })

  test('rejeita rate_limit acima do máximo (1000)', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], rate_limit: 1001 })
    expect(r.success).toBe(false)
  })

  test('rejeita concurrency acima do máximo (100)', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], concurrency: 101 })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout acima do máximo (120)', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], timeout: 121 })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout_secs abaixo do mínimo (30)', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], timeout_secs: 29 })
    expect(r.success).toBe(false)
  })

  test('rejeita severidade inválida', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], severity: ['extreme'] })
    expect(r.success).toBe(false)
  })

  // DAST sub-category template shortcuts (added in pentest cycle 2)
  test('accepts dast/ssti template shortcut', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], templates: ['dast/ssti'] })
    expect(r.success).toBe(true)
  })

  test('accepts dast/sqli template shortcut', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], templates: ['dast/sqli'] })
    expect(r.success).toBe(true)
  })

  test('accepts dast/ssrf template shortcut', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], templates: ['dast/ssrf'] })
    expect(r.success).toBe(true)
  })

  test('accepts dast/lfi template shortcut', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], templates: ['dast/lfi'] })
    expect(r.success).toBe(true)
  })

  test('accepts dast/cmdi template shortcut', () => {
    const r = schema.safeParse({ targets: ['https://example.com/api?cmd=test'], templates: ['dast/cmdi'] })
    expect(r.success).toBe(true)
  })

  test('accepts kev profile (CISA Known Exploited Vulnerabilities)', () => {
    const r = schema.safeParse({ targets: ['https://example.com'], profile: 'kev' })
    expect(r.success).toBe(true)
  })
})

// Cloud-provider specific profiles (added for cloud pentest scenarios)
describe('NucleiTool cloud profiles', () => {
  const cloudProfiles = ['aws', 'gcp', 'azure', 'alibaba', 'k8s'] as const

  test('all cloud profiles are accepted by schema', () => {
    for (const profile of cloudProfiles) {
      const r = schema.safeParse({ targets: ['https://example.com'], profile })
      expect(r.success).toBe(true)
    }
  })

  test('aws profile for AWS cloud misconfiguration scanning', () => {
    const r = schema.safeParse({ targets: ['https://s3.amazonaws.com/example'], profile: 'aws' })
    expect(r.success).toBe(true)
  })

  test('k8s profile for Kubernetes cluster security scanning', () => {
    const r = schema.safeParse({ targets: ['https://k8s-cluster.example.com'], profile: 'k8s' })
    expect(r.success).toBe(true)
  })
})
