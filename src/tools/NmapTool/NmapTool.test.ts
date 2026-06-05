import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const SCAN_TYPES = [
  'quick', 'service', 'full', 'vuln', 'scripts', 'custom',
  'aggressive', 'udp', 'stealth', 'ping_sweep', 'os_detect', 'script_cat',
] as const

const NSE_CATEGORIES = [
  'auth', 'brute', 'default', 'discovery', 'dos', 'exploit',
  'external', 'fuzzer', 'intrusive', 'malware', 'safe', 'version', 'vuln',
] as const

const schema = z.strictObject({
  targets: z.array(z.string()).min(1),
  ports: z.string().optional(),
  scan_type: z.enum(SCAN_TYPES).default('quick'),
  scripts: z.array(z.string()).optional(),
  script_categories: z.array(z.enum(NSE_CATEGORIES)).optional(),
  script_args: z.record(z.string(), z.string()).optional(),
  timing: z.number().int().min(0).max(5).default(4),
  no_ping: z.boolean().optional(),
  os_detect: z.boolean().optional(),
  traceroute: z.boolean().optional(),
  min_rate: z.number().int().min(1).optional(),
  max_retries: z.number().int().min(0).optional(),
  extra_args: z.string().optional(),
  timeout_secs: z.number().int().min(10).max(3600).default(300),
})

describe('NmapTool schema', () => {
  test('accepts minimal quick scan', () => {
    const r = schema.safeParse({ targets: ['192.168.1.1'] })
    expect(r.success).toBe(true)
  })

  test('defaults scan_type to quick', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'] })
    if (r.success) expect(r.data.scan_type).toBe('quick')
  })

  test('defaults timing to 4', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'] })
    if (r.success) expect(r.data.timing).toBe(4)
  })

  test('defaults timeout_secs to 300', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'] })
    if (r.success) expect(r.data.timeout_secs).toBe(300)
  })

  test('accepts all scan types', () => {
    for (const scan_type of SCAN_TYPES) {
      const r = schema.safeParse({ targets: ['10.0.0.1'], scan_type })
      expect(r.success).toBe(true)
    }
  })

  test('accepts aggressive scan with OS detection', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'], scan_type: 'aggressive', os_detect: true })
    expect(r.success).toBe(true)
  })

  test('accepts scripts for scripts scan_type', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'], scan_type: 'scripts', scripts: ['smb-enum-shares'] })
    expect(r.success).toBe(true)
  })

  test('accepts NSE category filter', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'], scan_type: 'script_cat', script_categories: ['auth', 'brute'] })
    expect(r.success).toBe(true)
  })

  test('accepts CIDR range target', () => {
    const r = schema.safeParse({ targets: ['192.168.0.0/24'], scan_type: 'ping_sweep' })
    expect(r.success).toBe(true)
  })

  test('accepts port specification', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'], ports: '22,80,443,8080' })
    expect(r.success).toBe(true)
  })

  test('accepts no_ping for firewalled hosts', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'], scan_type: 'service', no_ping: true })
    expect(r.success).toBe(true)
  })

  test('accepts custom scan with extra_args', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'], scan_type: 'custom', extra_args: '--open -T3' })
    expect(r.success).toBe(true)
  })

  test('rejects empty targets array', () => {
    const r = schema.safeParse({ targets: [] })
    expect(r.success).toBe(false)
  })

  test('rejects missing targets', () => {
    const r = schema.safeParse({ scan_type: 'quick' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid scan_type', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'], scan_type: 'stealth2' })
    expect(r.success).toBe(false)
  })

  test('rejects timing out of range', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'], timing: 6 })
    expect(r.success).toBe(false)
  })

  test('rejects invalid NSE category', () => {
    const r = schema.safeParse({ targets: ['10.0.0.1'], script_categories: ['xss'] })
    expect(r.success).toBe(false)
  })
})

// =============================================================================
// NmapTool — pentest scan scenarios
// =============================================================================

describe('NmapTool — pentest scan scenarios', () => {
  test('SMB vuln scan for EternalBlue/SMBGhost', () => {
    const r = schema.safeParse({
      targets: ['10.0.0.1'],
      scan_type: 'scripts',
      scripts: ['smb-vuln-ms17-010', 'smb-vuln-cve-2020-0796'],
      ports: '445',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.scripts).toContain('smb-vuln-ms17-010')
      expect(r.data.ports).toBe('445')
    }
  })

  test('Redis unauthenticated check (scan port 6379)', () => {
    const r = schema.safeParse({
      targets: ['127.0.0.1'],
      scan_type: 'service',
      ports: '6379',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.ports).toBe('6379')
  })

  test('auth brute discovery scripts', () => {
    const r = schema.safeParse({
      targets: ['10.0.0.1'],
      scan_type: 'script_cat',
      script_categories: ['auth', 'brute'],
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.script_categories).toContain('brute')
  })

  test('stealth subnet sweep for AD target discovery', () => {
    const r = schema.safeParse({
      targets: ['192.168.1.0/24'],
      scan_type: 'stealth',
      ports: '22,80,443,445,3389,8080',
      min_rate: 500,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.scan_type).toBe('stealth')
      expect(r.data.min_rate).toBe(500)
    }
  })
})
