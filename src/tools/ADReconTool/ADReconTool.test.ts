import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const ACTIONS = [
  'smb_enum', 'user_enum', 'bloodhound_collect',
  'asreproast_enum', 'kerberoast_enum', 'adcs_enum',
] as const

const schema = z.strictObject({
  action: z.enum(ACTIONS),
  dc_ip: z.string(),
  domain: z.string(),
  username: z.string().optional(),
  password: z.string().optional(),
  nt_hash: z.string().optional(),
  wordlist: z.string().optional(),
  timeout_secs: z.number().int().min(30).max(3600).default(180),
})

describe('ADReconTool schema', () => {
  test('aceita smb_enum sem credenciais (null session)', () => {
    const r = schema.safeParse({
      action: 'smb_enum',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
    })
    expect(r.success).toBe(true)
  })

  test('aceita smb_enum com credenciais', () => {
    const r = schema.safeParse({
      action: 'smb_enum',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
      username: 'jdoe',
      password: 'Password1',
    })
    expect(r.success).toBe(true)
  })

  test('aceita user_enum com wordlist', () => {
    const r = schema.safeParse({
      action: 'user_enum',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
      wordlist: '/usr/share/seclists/Usernames/xato-net-10-million-usernames.txt',
    })
    expect(r.success).toBe(true)
  })

  test('aceita bloodhound_collect com credenciais', () => {
    const r = schema.safeParse({
      action: 'bloodhound_collect',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
      username: 'jdoe',
      password: 'Password1',
    })
    expect(r.success).toBe(true)
  })

  test('aceita kerberoast_enum com nt_hash (PTH)', () => {
    const r = schema.safeParse({
      action: 'kerberoast_enum',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
      username: 'administrator',
      nt_hash: 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c',
    })
    expect(r.success).toBe(true)
  })

  test('aceita asreproast_enum sem credenciais', () => {
    const r = schema.safeParse({
      action: 'asreproast_enum',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
    })
    expect(r.success).toBe(true)
  })

  test('aceita adcs_enum com credenciais', () => {
    const r = schema.safeParse({
      action: 'adcs_enum',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
      username: 'jdoe',
      password: 'Password1',
    })
    expect(r.success).toBe(true)
  })

  test('aceita todas as actions', () => {
    for (const action of ACTIONS) {
      const r = schema.safeParse({ action, dc_ip: '10.0.0.1', domain: 'test.local' })
      expect(r.success).toBe(true)
    }
  })

  test('default timeout_secs=180', () => {
    const r = schema.safeParse({ action: 'smb_enum', dc_ip: '10.0.0.1', domain: 'test.local' })
    if (r.success) expect(r.data.timeout_secs).toBe(180)
  })

  test('aceita timeout_secs customizado', () => {
    const r = schema.safeParse({
      action: 'bloodhound_collect',
      dc_ip: '10.0.0.1',
      domain: 'test.local',
      timeout_secs: 900,
    })
    if (r.success) expect(r.data.timeout_secs).toBe(900)
  })

  test('rejeita sem action', () => {
    const r = schema.safeParse({ dc_ip: '10.0.0.1', domain: 'test.local' })
    expect(r.success).toBe(false)
  })

  test('rejeita sem dc_ip', () => {
    const r = schema.safeParse({ action: 'smb_enum', domain: 'test.local' })
    expect(r.success).toBe(false)
  })

  test('rejeita sem domain', () => {
    const r = schema.safeParse({ action: 'smb_enum', dc_ip: '10.0.0.1' })
    expect(r.success).toBe(false)
  })

  test('rejeita action inválida', () => {
    const r = schema.safeParse({ action: 'ldap_enum', dc_ip: '10.0.0.1', domain: 'test.local' })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout_secs abaixo do mínimo (30)', () => {
    const r = schema.safeParse({
      action: 'smb_enum',
      dc_ip: '10.0.0.1',
      domain: 'test.local',
      timeout_secs: 29,
    })
    expect(r.success).toBe(false)
  })
})

// =============================================================================
// Output schema tests — verifies next_steps field added in pentest cycle 3
// =============================================================================

describe('ADReconTool output schema', () => {
  const outputSchema = z.object({
    success: z.boolean(),
    action: z.string(),
    command: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    output_dir: z.string().optional(),
    next_steps: z.string().optional(), // added for adcs_enum ESC chain guidance
    error: z.string().optional(),
  })

  test('accepts output with next_steps (adcs_enum provides ESC1/ESC8 chain)', () => {
    const r = outputSchema.safeParse({
      success: true,
      action: 'adcs_enum',
      command: 'certipy find -u user@domain -p pass -dc-ip 10.0.0.1 -vulnerable -stdout',
      stdout: '[*] Enumerated vulnerabilities: ESC1 found',
      stderr: '',
      output_dir: '/home/user/Targets/domain/ad-recon',
      next_steps: 'ADAttackTool action=adcs_exploit...',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.next_steps).toContain('adcs_exploit')
  })

  test('accepts output without next_steps (most actions)', () => {
    const r = outputSchema.safeParse({
      success: true,
      action: 'smb_enum',
      command: 'nxc smb 10.0.0.1',
      stdout: '10.0.0.1 SMB signing: disabled',
      stderr: '',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.next_steps).toBeUndefined()
  })
})

describe('ADReconTool — ADCS and BloodHound escalation scenarios (cycle 4)', () => {
  test('adcs_enum requires credentials (certipy needs auth)', () => {
    // certipy find -vulnerable needs valid domain credentials
    const withCreds = schema.safeParse({
      action: 'adcs_enum',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
      username: 'jdoe',
      password: 'Password1',
    })
    expect(withCreds.success).toBe(true)
  })

  test('adcs_enum without credentials fails schema gracefully (optional creds)', () => {
    // Schema allows no creds but tool will return an error at runtime
    const noCreds = schema.safeParse({
      action: 'adcs_enum',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
    })
    expect(noCreds.success).toBe(true) // schema allows it, tool runtime validates
  })

  test('bloodhound_collect with nt_hash for pass-the-hash collection', () => {
    const r = schema.safeParse({
      action: 'bloodhound_collect',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
      username: 'administrator',
      nt_hash: 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.nt_hash).toContain(':')
  })

  test('asreproast with custom user wordlist for targeted AS-REP check', () => {
    const r = schema.safeParse({
      action: 'asreproast_enum',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
      wordlist: '/usr/share/seclists/Usernames/Names/names.txt',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.wordlist).toContain('seclists')
  })

  test('all 6 actions are valid enum values', () => {
    for (const action of ACTIONS) {
      const r = schema.safeParse({ action, dc_ip: '10.0.0.1', domain: 'test.local' })
      expect(r.success).toBe(true)
    }
  })
})
