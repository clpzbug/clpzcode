import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const OPERATIONS = [
  'hash', 'encode_base64', 'decode_base64', 'encode_hex', 'decode_hex',
  'encrypt_aes', 'decrypt_aes', 'gen_rsa_key', 'gen_self_signed_cert',
  'parse_cert', 'random_bytes',
] as const

const schema = z.strictObject({
  operation: z.enum(OPERATIONS),
  data: z.string().optional(),
  data_file: z.string().optional(),
  algorithm: z.string().optional(),
  key: z.string().optional(),
  password: z.string().optional(),
  iv: z.string().optional(),
  bits: z.number().int().min(512).max(4096).default(2048),
  count: z.number().int().min(1).max(1024).default(32),
  subject: z.string().optional(),
  days: z.number().int().min(1).max(3650).default(365),
})

describe('CryptoTool schema', () => {
  test('accepts hash operation with data', () => {
    const r = schema.safeParse({ operation: 'hash', data: 'hello world', algorithm: 'sha256' })
    expect(r.success).toBe(true)
  })

  test('accepts encode_base64', () => {
    const r = schema.safeParse({ operation: 'encode_base64', data: 'secret' })
    expect(r.success).toBe(true)
  })

  test('accepts gen_rsa_key with bits', () => {
    const r = schema.safeParse({ operation: 'gen_rsa_key', bits: 4096 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.bits).toBe(4096)
  })

  test('accepts random_bytes with count', () => {
    const r = schema.safeParse({ operation: 'random_bytes', count: 16 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.count).toBe(16)
  })

  test('defaults bits to 2048', () => {
    const r = schema.safeParse({ operation: 'gen_rsa_key' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.bits).toBe(2048)
  })

  test('defaults count to 32', () => {
    const r = schema.safeParse({ operation: 'random_bytes' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.count).toBe(32)
  })

  test('defaults days to 365', () => {
    const r = schema.safeParse({ operation: 'gen_self_signed_cert' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.days).toBe(365)
  })

  test('rejects missing operation', () => {
    const r = schema.safeParse({ data: 'hello' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid operation', () => {
    const r = schema.safeParse({ operation: 'sign_jwt' })
    expect(r.success).toBe(false)
  })

  test('rejects bits below minimum', () => {
    const r = schema.safeParse({ operation: 'gen_rsa_key', bits: 256 })
    expect(r.success).toBe(false)
  })

  test('accepts hash with sha256 algorithm', () => {
    const r = schema.safeParse({ operation: 'hash', data: 'hello', algorithm: 'sha256' })
    expect(r.success).toBe(true)
  })

  test('accepts hash with md5 algorithm (for legacy hash identification)', () => {
    const r = schema.safeParse({ operation: 'hash', data: 'test', algorithm: 'md5' })
    expect(r.success).toBe(true)
  })

  test('accepts decode_base64 (for b64-encoded credentials)', () => {
    const r = schema.safeParse({ operation: 'decode_base64', data: 'dXNlcjpwYXNz' })
    expect(r.success).toBe(true)
  })

  test('accepts encode_hex (for URL encoding bypass)', () => {
    const r = schema.safeParse({ operation: 'encode_hex', data: 'payload' })
    expect(r.success).toBe(true)
  })

  test('accepts random_bytes with custom count (for OOB markers)', () => {
    // Used to generate unique OOB markers (e.g. 16-byte hex = 32-char string)
    const r = schema.safeParse({ operation: 'random_bytes', count: 16 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.count).toBe(16)
  })

  test('accepts all 11 operations', () => {
    for (const op of OPERATIONS) {
      const r = schema.safeParse({ operation: op })
      expect(r.success).toBe(true)
    }
  })

  test('operations count is 11', () => {
    expect(OPERATIONS.length).toBe(11)
  })
})
