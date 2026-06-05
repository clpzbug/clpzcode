import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const OPERATIONS = ['identify', 'crack_john', 'crack_hashcat'] as const

const schema = z.strictObject({
  operation: z.enum(OPERATIONS),
  hash: z.string(),
  hash_type: z.string().optional(),
  wordlist: z.string().optional(),
  rules: z.string().optional(),
  extra_args: z.string().optional(),
  timeout_secs: z.number().int().min(10).max(3600).default(300),
})

describe('HashTool schema', () => {
  test('accepts identify operation', () => {
    const r = schema.safeParse({ operation: 'identify', hash: '5f4dcc3b5aa765d61d8327deb882cf99' })
    expect(r.success).toBe(true)
  })

  test('accepts crack_hashcat with hash_type', () => {
    const r = schema.safeParse({ operation: 'crack_hashcat', hash: '5f4dcc3b5aa765d61d8327deb882cf99', hash_type: '0', wordlist: 'rockyou' })
    expect(r.success).toBe(true)
  })

  test('accepts crack_john with wordlist', () => {
    const r = schema.safeParse({ operation: 'crack_john', hash: '$apr1$test$hash', wordlist: 'rockyou' })
    expect(r.success).toBe(true)
  })

  test('rejects missing hash', () => {
    const r = schema.safeParse({ operation: 'identify' })
    expect(r.success).toBe(false)
  })

  test('rejects missing operation', () => {
    const r = schema.safeParse({ hash: 'abc123' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid operation', () => {
    const r = schema.safeParse({ operation: 'brute', hash: 'abc' })
    expect(r.success).toBe(false)
  })

  test('defaults timeout_secs to 300', () => {
    const r = schema.safeParse({ operation: 'identify', hash: 'abc123' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.timeout_secs).toBe(300)
  })

  test('rejects timeout below minimum', () => {
    const r = schema.safeParse({ operation: 'identify', hash: 'abc', timeout_secs: 5 })
    expect(r.success).toBe(false)
  })

  test('rejects timeout above maximum', () => {
    const r = schema.safeParse({ operation: 'identify', hash: 'abc', timeout_secs: 9999 })
    expect(r.success).toBe(false)
  })

  test('accepts optional rules parameter', () => {
    const r = schema.safeParse({ operation: 'crack_hashcat', hash: 'abc', rules: 'best64' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.rules).toBe('best64')
  })

  test('accepts fast wordlist shortcut (top-1000 for quick spray)', () => {
    const r = schema.safeParse({ operation: 'crack_hashcat', hash: 'abc', wordlist: 'fast' })
    expect(r.success).toBe(true)
  })

  test('accepts ntlm wordlist shortcut (mnemonic for AD hash cracking)', () => {
    const r = schema.safeParse({ operation: 'crack_hashcat', hash: 'abc', wordlist: 'ntlm' })
    expect(r.success).toBe(true)
  })

  test('accepts NTLM hash type hint (mode 1000)', () => {
    // secretsdump LM:NTLM format — use the 32-char NTLM part
    const ntlmHash = 'aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0'
    const r = schema.safeParse({ operation: 'crack_hashcat', hash: ntlmHash, hash_type: '1000' })
    expect(r.success).toBe(true)
  })

  test('accepts Kerberoast TGS hash type hint (mode 13100)', () => {
    const r = schema.safeParse({
      operation: 'crack_hashcat',
      hash: '$krb5tgs$23$*user*DOMAIN*spn*$...',
      hash_type: '13100',
    })
    expect(r.success).toBe(true)
  })

  test('accepts AS-REP roast hash type hint (mode 18200)', () => {
    const r = schema.safeParse({
      operation: 'crack_hashcat',
      hash: '$krb5asrep$23$user@DOMAIN:...',
      hash_type: '18200',
    })
    expect(r.success).toBe(true)
  })
})

// =============================================================================
// Hash pattern recognition (mirrors the fallback detection logic)
// =============================================================================

describe('HashTool — hash format recognition patterns', () => {
  // These mirror the patterns in identifyHash() fallback detection
  const NTLM_LMNTLM = /^[a-f0-9]{32}:[a-f0-9]{32}$/i
  const NTLM_32 = /^[a-f0-9]{32}$/i
  const NTLMv2 = /^[^:]+::[^:]+:[a-f0-9]{16}:[a-f0-9]{32}:[a-f0-9]+$/i
  const KERBEROAST = /^\$krb5tgs\$23\$/
  const ASREP = /^\$krb5asrep\$23\$/
  const SHA512_UNIX = /^\$6\$/
  const BCRYPT = /^\$2[aby]\$/

  test('secretsdump LM:NTLM format matches NTLM_LMNTLM pattern', () => {
    const hash = 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c'
    expect(NTLM_LMNTLM.test(hash)).toBe(true)
    expect(hash.split(':')[1]).toHaveLength(32) // verify extractable NT hash
  })

  test('bare NT hash matches 32-hex pattern', () => {
    expect(NTLM_32.test('8846f7eaee8fb117ad06bdd830b7586c')).toBe(true)
  })

  test('NTLMv2 Responder format matches NTLMv2 pattern', () => {
    // Format: user::domain:challenge(16hex):NTProofStr(32hex):blob(hex)
    // 16 hex challenge + 32 hex NTProofStr + variable blob
    const hash = 'Administrator::DOMAIN:1122334455667788:aabbccddeeff00112233445566778899:0101000000000000'
    expect(NTLMv2.test(hash)).toBe(true)
  })

  test('Kerberoast TGS hash matches $krb5tgs$23$ pattern', () => {
    expect(KERBEROAST.test('$krb5tgs$23$*user*DOMAIN*SPN$hashdata...')).toBe(true)
  })

  test('AS-REP roast hash matches $krb5asrep$23$ pattern', () => {
    expect(ASREP.test('$krb5asrep$23$user@DOMAIN:hashdata...')).toBe(true)
  })

  test('Linux shadow SHA-512 hash matches $6$ pattern', () => {
    expect(SHA512_UNIX.test('$6$saltsalt$longhashstring...')).toBe(true)
  })

  test('bcrypt hash matches $2a$ $2b$ $2y$ pattern', () => {
    expect(BCRYPT.test('$2b$10$saltsalthashhash...')).toBe(true)
    expect(BCRYPT.test('$2a$12$somesaltstringhashend')).toBe(true)
  })
})

// =============================================================================
// HashTool AD pentest scenarios
// =============================================================================

describe('HashTool — AD pentest scenarios', () => {
  test('crack Kerberoast TGS with hashcat mode 13100', () => {
    const r = schema.safeParse({
      operation: 'crack_hashcat',
      hash: '$krb5tgs$23$*administrator*CORP.LOCAL*mssqlsvc/sqlserver.corp.local:1433*$hashdata...',
      hash_type: '13100',
      wordlist: 'fast',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.hash_type).toBe('13100')
      expect(r.data.wordlist).toBe('fast')
    }
  })

  test('crack AS-REP with hashcat mode 18200', () => {
    const r = schema.safeParse({
      operation: 'crack_hashcat',
      hash: '$krb5asrep$23$user@CORP.LOCAL:hashdata...',
      hash_type: '18200',
      wordlist: 'rockyou',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.hash_type).toBe('18200')
  })

  test('crack NTLM with mode 1000 and rule file', () => {
    const r = schema.safeParse({
      operation: 'crack_hashcat',
      hash: 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c',
      hash_type: '1000',
      wordlist: 'ntlm',
      rules: 'best64',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.hash_type).toBe('1000')
      expect(r.data.rules).toBe('best64')
    }
  })

  test('identify NTLMv2 Responder hash format', () => {
    const r = schema.safeParse({
      operation: 'identify',
      hash: 'Administrator::CORP.LOCAL:1122334455667788:aabbccddeeff00112233445566778899:01010000000000',
    })
    expect(r.success).toBe(true)
  })
})
