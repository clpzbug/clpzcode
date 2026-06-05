import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const SERVICES = [
  'ssh', 'ftp', 'http-get', 'http-post-form', 'https-get', 'https-post-form',
  'smb', 'telnet', 'mysql', 'mssql', 'rdp', 'vnc', 'pop3', 'smtp',
  'imap', 'ldap2', 'ldap3', 'redis', 'mongodb', 'snmp',
  'postgres', 'winrm',
] as const

const schema = z.strictObject({
  target: z.string(),
  service: z.enum(SERVICES),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().optional(),
  username_file: z.string().optional(),
  password: z.string().optional(),
  password_file: z.string().optional(),
  http_path: z.string().optional(),
  http_form_data: z.string().optional(),
  http_success_string: z.string().optional(),
  threads: z.number().int().min(1).max(64).default(4),
  timeout_secs: z.number().int().min(10).max(3600).default(300),
  extra_args: z.string().optional(),
})

describe('BruteForceTool schema', () => {
  test('accepts SSH with single username and password_file', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'ssh', username: 'admin', password_file: 'rockyou' })
    expect(r.success).toBe(true)
  })

  test('accepts FTP with username and password file', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'ftp', username_file: 'usernames', password_file: 'top100' })
    expect(r.success).toBe(true)
  })

  test('accepts HTTP GET with path', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'http-get', http_path: '/admin', username: 'admin', password: 'secret' })
    expect(r.success).toBe(true)
  })

  test('accepts HTTP POST form with form data', () => {
    const r = schema.safeParse({
      target: '10.0.0.1',
      service: 'http-post-form',
      http_path: '/login',
      http_form_data: 'user=^USER^&pass=^PASS^',
      username: 'admin',
      password_file: 'top1000',
    })
    expect(r.success).toBe(true)
  })

  test('accepts all services', () => {
    for (const service of SERVICES) {
      const r = schema.safeParse({ target: '10.0.0.1', service })
      expect(r.success).toBe(true)
    }
  })

  test('defaults threads to 4', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'ssh' })
    if (r.success) expect(r.data.threads).toBe(4)
  })

  test('defaults timeout_secs to 300', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'ssh' })
    if (r.success) expect(r.data.timeout_secs).toBe(300)
  })

  test('accepts custom port', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'ssh', port: 2222 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.port).toBe(2222)
  })

  test('rejects missing target', () => {
    const r = schema.safeParse({ service: 'ssh' })
    expect(r.success).toBe(false)
  })

  test('rejects missing service', () => {
    const r = schema.safeParse({ target: '10.0.0.1' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid service', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'telnet2' })
    expect(r.success).toBe(false)
  })

  test('rejects threads above max (64)', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'ssh', threads: 65 })
    expect(r.success).toBe(false)
  })

  test('rejects port 0', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'ssh', port: 0 })
    expect(r.success).toBe(false)
  })

  test('accepts extra_args for additional hydra flags', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'ssh', username: 'root', password: 'toor', extra_args: '-V -I' })
    expect(r.success).toBe(true)
  })

  test('accepts postgres service (PostgreSQL brute force)', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'postgres', username: 'postgres', password_file: 'top1000' })
    expect(r.success).toBe(true)
  })

  test('accepts winrm service (Windows Remote Management for lateral movement)', () => {
    const r = schema.safeParse({ target: '10.0.0.1', service: 'winrm', username: 'administrator', password_file: 'top100' })
    expect(r.success).toBe(true)
  })

  test('services count is 22 (includes postgres and winrm)', () => {
    expect(SERVICES.length).toBe(22)
  })
})

describe('BruteForceTool — post-escalation scenarios (cycle 4)', () => {
  test('password spray after Kerberoast crack — SMB service', () => {
    // Cracked Kerberoast hash → spray cracked password across domain via SMB
    const r = schema.safeParse({
      target: '10.0.0.1',
      service: 'smb',
      username: 'svc_sql',
      password: 'Summer2024!',
      threads: 1,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.service).toBe('smb')
  })

  test('HTTP admin panel brute with form data', () => {
    const r = schema.safeParse({
      target: '10.0.0.1',
      service: 'http-post-form',
      http_path: '/admin/login',
      http_form_data: 'username=^USER^&password=^PASS^',
      username_file: 'usernames',
      password_file: 'top1000',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.http_form_data).toContain('^USER^')
      expect(r.data.http_form_data).toContain('^PASS^')
    }
  })

  test('RDP brute against Administrator after NTLM hash unavailable', () => {
    const r = schema.safeParse({
      target: '10.0.0.1',
      service: 'rdp',
      username: 'administrator',
      password_file: 'rockyou',
      threads: 4,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.service).toBe('rdp')
  })

  test('MySQL brute on exposed database port', () => {
    const r = schema.safeParse({
      target: '10.0.0.1',
      service: 'mysql',
      username: 'root',
      password_file: 'top100',
    })
    expect(r.success).toBe(true)
  })
})
