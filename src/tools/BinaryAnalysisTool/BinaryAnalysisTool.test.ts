import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const OPERATIONS = ['file_info', 'strings', 'hexdump', 'disassemble', 'hex', 'symbols'] as const

const schema = z.strictObject({
  path: z.string(),
  operation: z.enum(OPERATIONS),
  offset: z.number().int().min(0).optional(),
  length: z.number().int().min(1).max(65536).optional(),
  min_string_len: z.number().int().min(1).max(100).default(4),
  section: z.string().optional(),
  extra_args: z.string().optional(),
})

describe('BinaryAnalysisTool schema', () => {
  test('accepts file_info operation', () => {
    const r = schema.safeParse({ path: '/tmp/binary', operation: 'file_info' })
    expect(r.success).toBe(true)
  })

  test('accepts strings with min_string_len', () => {
    const r = schema.safeParse({ path: '/tmp/binary', operation: 'strings', min_string_len: 8 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.min_string_len).toBe(8)
  })

  test('accepts hexdump with offset and length', () => {
    const r = schema.safeParse({ path: '/tmp/binary', operation: 'hexdump', offset: 0, length: 256 })
    expect(r.success).toBe(true)
  })

  test('accepts disassemble with section', () => {
    const r = schema.safeParse({ path: '/tmp/binary', operation: 'disassemble', section: '.text' })
    expect(r.success).toBe(true)
  })

  test('rejects missing path', () => {
    const r = schema.safeParse({ operation: 'file_info' })
    expect(r.success).toBe(false)
  })

  test('rejects missing operation', () => {
    const r = schema.safeParse({ path: '/tmp/binary' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid operation', () => {
    const r = schema.safeParse({ path: '/tmp/binary', operation: 'run' })
    expect(r.success).toBe(false)
  })

  test('defaults min_string_len to 4', () => {
    const r = schema.safeParse({ path: '/tmp/binary', operation: 'strings' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.min_string_len).toBe(4)
  })

  test('rejects length above max', () => {
    const r = schema.safeParse({ path: '/tmp/binary', operation: 'hexdump', length: 99999 })
    expect(r.success).toBe(false)
  })

  test('rejects negative offset', () => {
    const r = schema.safeParse({ path: '/tmp/binary', operation: 'hexdump', offset: -1 })
    expect(r.success).toBe(false)
  })
})

// =============================================================================
// symbols operation — added for binary exploitation + CTF analysis
// =============================================================================

describe('BinaryAnalysisTool symbols operation', () => {
  test('schema accepts symbols operation', () => {
    const r = schema.safeParse({ path: '/tmp/binary', operation: 'symbols' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.operation).toBe('symbols')
  })

  test('all 6 operations are valid (including symbols)', () => {
    for (const op of OPERATIONS) {
      const r = schema.safeParse({ path: '/tmp/binary', operation: op })
      expect(r.success).toBe(true)
    }
  })

  test('OPERATIONS count is 6 (symbols added in pentest cycle 3)', () => {
    expect(OPERATIONS.length).toBe(6)
  })

  test('symbols op does not require any optional fields', () => {
    // Unlike disassemble (section) or hexdump (offset/length), symbols works with just path
    const r = schema.safeParse({ path: '/bin/ls', operation: 'symbols' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.section).toBeUndefined()
      expect(r.data.offset).toBeUndefined()
      expect(r.data.length).toBeUndefined()
    }
  })
})

// =============================================================================
// Pentest security analysis scenarios
// =============================================================================

describe('BinaryAnalysisTool — pentest security scenarios', () => {
  test('file_info accepted for checking NX/PIE/canary protections', () => {
    // After getting a shell and finding a vulnerable binary, use file_info
    // to check security mitigations before attempting exploitation
    const r = schema.safeParse({ path: '/usr/bin/pkexec', operation: 'file_info' })
    expect(r.success).toBe(true)
  })

  test('strings with min_string_len=8 for credential search in binary', () => {
    // Find embedded passwords, API keys, or secrets in binary files
    const r = schema.safeParse({ path: '/usr/local/bin/app', operation: 'strings', min_string_len: 8 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.min_string_len).toBe(8)
  })

  test('symbols for finding dangerous imports (system, gets, execve)', () => {
    // List imported functions to identify vulnerable patterns
    const r = schema.safeParse({ path: '/usr/bin/target', operation: 'symbols' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.operation).toBe('symbols')
  })

  test('disassemble on non-standard section for ROP gadget hunting', () => {
    const r = schema.safeParse({ path: '/usr/bin/target', operation: 'disassemble', section: '.plt' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.section).toBe('.plt')
  })
})
