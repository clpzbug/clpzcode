import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const OPERATIONS = ['banner_grab', 'send', 'check_open', 'scan_ports'] as const

const schema = z.strictObject({
  host: z.string(),
  port: z.number().int().min(1).max(65535).optional(),
  operation: z.enum(OPERATIONS),
  data: z.string().optional(),
  ports: z.array(z.number().int().min(1).max(65535)).optional(),
  ssl: z.boolean().default(false),
  timeout_secs: z.number().int().min(1).max(30).default(5),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
})

describe('NetTool schema', () => {
  test('accepts banner_grab with host and port', () => {
    const r = schema.safeParse({ host: '10.0.0.1', port: 22, operation: 'banner_grab' })
    expect(r.success).toBe(true)
  })

  test('accepts scan_ports with ports array', () => {
    const r = schema.safeParse({ host: '10.0.0.1', operation: 'scan_ports', ports: [22, 80, 443] })
    expect(r.success).toBe(true)
  })

  test('accepts send with data', () => {
    const r = schema.safeParse({ host: '10.0.0.1', port: 80, operation: 'send', data: 'GET / HTTP/1.0\r\n\r\n' })
    expect(r.success).toBe(true)
  })

  test('accepts banner_grab with SSL', () => {
    const r = schema.safeParse({ host: '10.0.0.1', port: 443, operation: 'banner_grab', ssl: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.ssl).toBe(true)
  })

  test('rejects missing host', () => {
    const r = schema.safeParse({ port: 80, operation: 'banner_grab' })
    expect(r.success).toBe(false)
  })

  test('rejects missing operation', () => {
    const r = schema.safeParse({ host: '10.0.0.1', port: 80 })
    expect(r.success).toBe(false)
  })

  test('rejects port above max', () => {
    const r = schema.safeParse({ host: '10.0.0.1', port: 99999, operation: 'banner_grab' })
    expect(r.success).toBe(false)
  })

  test('defaults ssl to false', () => {
    const r = schema.safeParse({ host: '10.0.0.1', port: 80, operation: 'banner_grab' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.ssl).toBe(false)
  })

  test('defaults timeout_secs to 5', () => {
    const r = schema.safeParse({ host: '10.0.0.1', port: 80, operation: 'check_open' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.timeout_secs).toBe(5)
  })

  test('accepts udp protocol', () => {
    const r = schema.safeParse({ host: '10.0.0.1', port: 53, operation: 'check_open', protocol: 'udp' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.protocol).toBe('udp')
  })
})

// =============================================================================
// Pentest-specific usage tests
// =============================================================================

describe('NetTool — pentest scenarios', () => {
  test('banner_grab on Redis port 6379 (SSRF pivot target)', () => {
    const r = schema.safeParse({ host: '127.0.0.1', port: 6379, operation: 'banner_grab' })
    expect(r.success).toBe(true)
  })

  test('send to Redis with PING command (verify unauthenticated access)', () => {
    const r = schema.safeParse({
      host: '127.0.0.1',
      port: 6379,
      operation: 'send',
      data: '*1\r\n$4\r\nPING\r\n',
    })
    expect(r.success).toBe(true)
  })

  test('scan_ports for common internal service ports', () => {
    const r = schema.safeParse({
      host: '10.0.0.1',
      operation: 'scan_ports',
      ports: [22, 80, 443, 3306, 5432, 6379, 8080, 8443, 9200, 27017],
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.ports).toHaveLength(10)
  })

  test('banner_grab on Elasticsearch port 9200 (SSRF pivot target)', () => {
    const r = schema.safeParse({ host: '127.0.0.1', port: 9200, operation: 'banner_grab' })
    expect(r.success).toBe(true)
  })

  test('check_open on Docker daemon port 2375 (RCE via container spawn)', () => {
    const r = schema.safeParse({ host: '127.0.0.1', port: 2375, operation: 'check_open' })
    expect(r.success).toBe(true)
  })

  test('banner_grab with SSL on LDAP port 636 (AD LDAPS)', () => {
    const r = schema.safeParse({ host: '10.0.0.1', port: 636, operation: 'banner_grab', ssl: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.ssl).toBe(true)
  })
})

describe('NetTool — extended internal service exploitation scenarios (cycle 4)', () => {
  test('scan_ports on k8s/Consul/Docker attack surface', () => {
    // After SSRF confirms internal network access, enumerate this port list
    const r = schema.safeParse({
      host: '10.0.0.1',
      operation: 'scan_ports',
      ports: [2375, 2376, 6379, 8500, 9200, 5601, 6443, 8443, 10250, 27017, 11211],
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.ports).toHaveLength(11)
  })

  test('send GET request via NetTool for Elasticsearch cluster health', () => {
    // Confirm ES is unauthenticated by checking cluster health endpoint
    const r = schema.safeParse({
      host: '10.0.0.1',
      port: 9200,
      operation: 'send',
      data: 'GET /_cluster/health HTTP/1.0\r\nHost: 10.0.0.1\r\n\r\n',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.data).toContain('_cluster/health')
  })

  test('banner_grab on Kubernetes kubelet API port 10250', () => {
    // Kubelet API on :10250 can expose pod exec (unauthenticated in older k8s)
    const r = schema.safeParse({ host: '10.0.0.1', port: 10250, operation: 'banner_grab', ssl: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.port).toBe(10250)
  })

  test('check_open on Consul port 8500 (service registry + KV store)', () => {
    // Consul :8500 may expose KV store with secrets and service discovery
    const r = schema.safeParse({ host: '127.0.0.1', port: 8500, operation: 'check_open' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.port).toBe(8500)
  })

  test('send RESP PING to Redis for unauthenticated access check', () => {
    // Raw RESP protocol PING — +PONG response confirms no-auth Redis
    const pingCmd = '*1\r\n$4\r\nPING\r\n'
    const r = schema.safeParse({
      host: '10.0.0.1',
      port: 6379,
      operation: 'send',
      data: pingCmd,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.data).toBe(pingCmd)
  })

  test('banner_grab with max timeout (30) for slow internal services', () => {
    const r = schema.safeParse({ host: '10.0.0.1', port: 27017, operation: 'banner_grab', timeout_secs: 30 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.timeout_secs).toBe(30)
  })
})
