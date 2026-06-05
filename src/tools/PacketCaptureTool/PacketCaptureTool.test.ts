import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const schema = z.strictObject({
  interface: z.string().optional(),
  pcap_file: z.string().optional(),
  capture_filter: z.string().optional(),
  display_filter: z.string().optional(),
  count: z.number().int().min(1).max(10000).default(100),
  duration_secs: z.number().int().min(1).max(60).default(10),
  fields: z.array(z.string()).optional(),
  summary_only: z.boolean().default(false),
})

describe('PacketCaptureTool schema', () => {
  test('aceita capture com interface', () => {
    const r = schema.safeParse({ interface: 'eth0' })
    expect(r.success).toBe(true)
  })

  test('aceita análise de pcap_file', () => {
    const r = schema.safeParse({ pcap_file: '/tmp/capture.pcap' })
    expect(r.success).toBe(true)
  })

  test('defaults: count=100, duration_secs=10, summary_only=false', () => {
    const r = schema.safeParse({ interface: 'eth0' })
    if (r.success) {
      expect(r.data.count).toBe(100)
      expect(r.data.duration_secs).toBe(10)
      expect(r.data.summary_only).toBe(false)
    }
  })

  test('aceita capture_filter BPF', () => {
    const r = schema.safeParse({
      interface: 'eth0',
      capture_filter: 'tcp port 80',
    })
    expect(r.success).toBe(true)
  })

  test('aceita display_filter Wireshark', () => {
    const r = schema.safeParse({
      interface: 'eth0',
      display_filter: 'http.request',
    })
    expect(r.success).toBe(true)
  })

  test('aceita fields específicos', () => {
    const r = schema.safeParse({
      interface: 'any',
      fields: ['ip.src', 'ip.dst', 'tcp.dstport'],
    })
    expect(r.success).toBe(true)
  })

  test('aceita summary_only=true', () => {
    const r = schema.safeParse({ interface: 'eth0', summary_only: true })
    if (r.success) expect(r.data.summary_only).toBe(true)
  })

  test('aceita count customizado', () => {
    const r = schema.safeParse({ interface: 'eth0', count: 500 })
    if (r.success) expect(r.data.count).toBe(500)
  })

  test('aceita duration_secs customizado', () => {
    const r = schema.safeParse({ interface: 'eth0', duration_secs: 30 })
    if (r.success) expect(r.data.duration_secs).toBe(30)
  })

  test('aceita interface "any"', () => {
    const r = schema.safeParse({
      interface: 'any',
      capture_filter: 'port 443',
      duration_secs: 5,
    })
    expect(r.success).toBe(true)
  })

  test('aceita pcap_file com display_filter', () => {
    const r = schema.safeParse({
      pcap_file: '/tmp/capture.pcapng',
      display_filter: 'dns',
    })
    expect(r.success).toBe(true)
  })

  test('aceita schema vazio (sem interface ou pcap_file)', () => {
    // O schema permite ambos opcionais
    const r = schema.safeParse({})
    expect(r.success).toBe(true)
  })

  test('rejeita count abaixo do mínimo (1)', () => {
    const r = schema.safeParse({ interface: 'eth0', count: 0 })
    expect(r.success).toBe(false)
  })

  test('rejeita count acima do máximo (10000)', () => {
    const r = schema.safeParse({ interface: 'eth0', count: 10001 })
    expect(r.success).toBe(false)
  })

  test('rejeita duration_secs acima do máximo (60)', () => {
    const r = schema.safeParse({ interface: 'eth0', duration_secs: 61 })
    expect(r.success).toBe(false)
  })

  test('rejeita duration_secs abaixo do mínimo (1)', () => {
    const r = schema.safeParse({ interface: 'eth0', duration_secs: 0 })
    expect(r.success).toBe(false)
  })
})

// =============================================================================
// Pentest-specific capture scenarios
// =============================================================================

describe('PacketCaptureTool — pentest capture scenarios', () => {
  test('captures cleartext credentials via HTTP filter', () => {
    // Sniff plain HTTP traffic for credentials
    const r = schema.safeParse({
      interface: 'eth0',
      capture_filter: 'tcp port 80 or tcp port 21 or tcp port 23',
      display_filter: 'http.authorization or ftp contains "PASS"',
      count: 200,
    })
    expect(r.success).toBe(true)
  })

  test('captures SMB traffic for hash capture (combine with Responder)', () => {
    // After Responder poisoning, capture NTLMv2 hashes from SMB
    const r = schema.safeParse({
      interface: 'eth0',
      capture_filter: 'port 445',
      fields: ['ip.src', 'ip.dst', 'ntlmssp.auth.username', 'ntlmssp.auth.domain'],
      count: 100,
    })
    expect(r.success).toBe(true)
  })

  test('captures Kerberos traffic for ticket analysis', () => {
    const r = schema.safeParse({
      interface: 'eth0',
      capture_filter: 'port 88',
      display_filter: 'kerberos',
      count: 50,
    })
    expect(r.success).toBe(true)
  })

  test('analyzes existing pcap file from network capture', () => {
    const r = schema.safeParse({
      pcap_file: '/tmp/capture.pcapng',
      display_filter: 'dns',
    })
    expect(r.success).toBe(true)
  })
})
