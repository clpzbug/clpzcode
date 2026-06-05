import { describe, expect, test } from 'bun:test'
import { normalizeNtHash, resolveAuth } from './adUtils.js'

// ── normalizeNtHash ──────────────────────────────────────────────────────────

describe('normalizeNtHash', () => {
  test('bare 32-hex NT hash gets LM prefix added', () => {
    const nt = 'aad3b435b51404eeaad3b435b51404ee'
    const normalized = normalizeNtHash(nt)
    expect(normalized).toBe(`aad3b435b51404eeaad3b435b51404ee:${nt}`)
  })

  test('LM:NTLM format is returned unchanged', () => {
    const lmNt = 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c'
    expect(normalizeNtHash(lmNt)).toBe(lmNt)
  })

  test('handles uppercase NT hash (from secretsdump output)', () => {
    const nt = 'AAD3B435B51404EEAAD3B435B51404EE:8846F7EAEE8FB117AD06BDD830B7586C'
    // Already has colon — returned unchanged
    expect(normalizeNtHash(nt)).toBe(nt)
  })

  test('empty hash returns aad3b435... prefix with empty NT part', () => {
    // Edge case: empty string → no colon → gets LM prepended
    const result = normalizeNtHash('')
    expect(result).toContain(':')
  })
})

// ── resolveAuth ──────────────────────────────────────────────────────────────

describe('resolveAuth', () => {
  test('password auth: hasAuth=true, hash empty', () => {
    const { hash, hasAuth } = resolveAuth('jdoe', 'Password1', undefined)
    expect(hasAuth).toBe(true)
    expect(hash).toBe('')
  })

  test('hash auth: hasAuth=true, hash normalized', () => {
    const ntHash = '8846f7eaee8fb117ad06bdd830b7586c'
    const { hash, hasAuth } = resolveAuth('jdoe', '', ntHash)
    expect(hasAuth).toBe(true)
    expect(hash).toContain(':')
    expect(hash).toContain(ntHash)
  })

  test('no credentials: hasAuth=false', () => {
    const { hasAuth } = resolveAuth('', '', undefined)
    expect(hasAuth).toBe(false)
  })

  test('username with empty password and no hash: hasAuth=false', () => {
    const { hasAuth } = resolveAuth('jdoe', '', undefined)
    expect(hasAuth).toBe(false)
  })

  test('empty username with password: hasAuth=false (username required)', () => {
    const { hasAuth } = resolveAuth('', 'Password1', undefined)
    expect(hasAuth).toBe(false)
  })

  test('LM:NTLM hash is passed through normalizeNtHash', () => {
    const fullHash = 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c'
    const { hash } = resolveAuth('user', '', fullHash)
    expect(hash).toBe(fullHash) // already normalized, returned unchanged
  })
})
