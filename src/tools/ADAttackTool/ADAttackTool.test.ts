import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const ACTIONS = ['kerberoast', 'asreproast', 'adcs_exploit', 'dcsync', 'rbcd_setup', 'relay_setup'] as const
const RELAY_TYPES = ['ldap', 'smb', 'adcs'] as const

const schema = z.strictObject({
  action: z.enum(ACTIONS),
  dc_ip: z.string(),
  domain: z.string(),
  username: z.string().optional(),
  password: z.string().optional(),
  nt_hash: z.string().optional(),
  ca_name: z.string().optional(),
  template: z.string().optional(),
  upn: z.string().optional(),
  target_computer: z.string().optional(),
  attacker_computer: z.string().optional(),
  attacker_computer_hash: z.string().optional(),
  relay_target: z.string().optional(),
  relay_type: z.enum(RELAY_TYPES).optional(),
  timeout_secs: z.number().int().min(30).max(3600).default(180),
})

describe('ADAttackTool schema', () => {
  test('aceita kerberoast com credenciais', () => {
    const r = schema.safeParse({
      action: 'kerberoast',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
      username: 'jdoe',
      password: 'Password1',
    })
    expect(r.success).toBe(true)
  })

  test('aceita asreproast sem credenciais', () => {
    const r = schema.safeParse({
      action: 'asreproast',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
    })
    expect(r.success).toBe(true)
  })

  test('aceita dcsync com nt_hash', () => {
    const r = schema.safeParse({
      action: 'dcsync',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
      username: 'administrator',
      nt_hash: 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c',
    })
    expect(r.success).toBe(true)
  })

  test('aceita adcs_exploit com ca_name, template e upn', () => {
    const r = schema.safeParse({
      action: 'adcs_exploit',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
      username: 'jdoe',
      password: 'Password1',
      ca_name: 'contoso-CA',
      template: 'User',
      upn: 'administrator@contoso.local',
    })
    expect(r.success).toBe(true)
  })

  test('aceita rbcd_setup com target e attacker computer', () => {
    const r = schema.safeParse({
      action: 'rbcd_setup',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
      username: 'jdoe',
      password: 'Password1',
      target_computer: 'DC01$',
      attacker_computer: 'ATTACKER$',
      attacker_computer_hash: 'aad3b435b51404eeaad3b435b51404ee:abc123',
    })
    expect(r.success).toBe(true)
  })

  test('aceita relay_setup com target e tipo', () => {
    const r = schema.safeParse({
      action: 'relay_setup',
      dc_ip: '10.0.0.1',
      domain: 'contoso.local',
      relay_target: '10.0.0.5',
      relay_type: 'ldap',
    })
    expect(r.success).toBe(true)
  })

  test('aceita todas as actions', () => {
    for (const action of ACTIONS) {
      const r = schema.safeParse({ action, dc_ip: '10.0.0.1', domain: 'test.local' })
      expect(r.success).toBe(true)
    }
  })

  test('aceita todos os relay_types', () => {
    for (const relay_type of RELAY_TYPES) {
      const r = schema.safeParse({
        action: 'relay_setup',
        dc_ip: '10.0.0.1',
        domain: 'test.local',
        relay_type,
      })
      expect(r.success).toBe(true)
    }
  })

  test('default timeout_secs=180', () => {
    const r = schema.safeParse({ action: 'kerberoast', dc_ip: '10.0.0.1', domain: 'test.local' })
    if (r.success) expect(r.data.timeout_secs).toBe(180)
  })

  test('aceita timeout_secs customizado', () => {
    const r = schema.safeParse({
      action: 'dcsync',
      dc_ip: '10.0.0.1',
      domain: 'test.local',
      timeout_secs: 600,
    })
    if (r.success) expect(r.data.timeout_secs).toBe(600)
  })

  test('rejeita sem action', () => {
    const r = schema.safeParse({ dc_ip: '10.0.0.1', domain: 'test.local' })
    expect(r.success).toBe(false)
  })

  test('rejeita sem dc_ip', () => {
    const r = schema.safeParse({ action: 'kerberoast', domain: 'test.local' })
    expect(r.success).toBe(false)
  })

  test('rejeita sem domain', () => {
    const r = schema.safeParse({ action: 'kerberoast', dc_ip: '10.0.0.1' })
    expect(r.success).toBe(false)
  })

  test('rejeita action inválida', () => {
    const r = schema.safeParse({ action: 'zerologon', dc_ip: '10.0.0.1', domain: 'test.local' })
    expect(r.success).toBe(false)
  })

  test('rejeita relay_type inválido', () => {
    const r = schema.safeParse({
      action: 'relay_setup',
      dc_ip: '10.0.0.1',
      domain: 'test.local',
      relay_type: 'https',
    })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout_secs acima do máximo (3600)', () => {
    const r = schema.safeParse({
      action: 'dcsync',
      dc_ip: '10.0.0.1',
      domain: 'test.local',
      timeout_secs: 3601,
    })
    expect(r.success).toBe(false)
  })
})

// =============================================================================
// ADAttackTool pentest priority and escalation tests
// =============================================================================

describe('ADAttackTool priority order', () => {
  test('adcs_exploit (highest priority) accepted with full params', () => {
    const r = schema.safeParse({
      action: 'adcs_exploit',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
      username: 'jdoe',
      password: 'Password1',
      ca_name: 'corp-CA',
      template: 'User',
      upn: 'administrator@corp.local',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.ca_name).toBe('corp-CA')
      expect(r.data.template).toBe('User')
      expect(r.data.upn).toBe('administrator@corp.local')
    }
  })

  test('dcsync (highest impact) accepted with DA credentials', () => {
    const r = schema.safeParse({
      action: 'dcsync',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
      username: 'administrator',
      nt_hash: 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.nt_hash).toContain(':')
  })

  test('relay_setup for ADCS ESC8 via ntlmrelayx', () => {
    const r = schema.safeParse({
      action: 'relay_setup',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
      relay_target: '10.0.0.5',
      relay_type: 'adcs',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.relay_type).toBe('adcs')
      expect(r.data.relay_target).toBe('10.0.0.5')
    }
  })
})

describe('ADAttackTool — pass-the-hash and lateral movement scenarios (cycle 4)', () => {
  test('kerberoast with nt_hash instead of password', () => {
    const r = schema.safeParse({
      action: 'kerberoast',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
      username: 'jdoe',
      nt_hash: 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.nt_hash).toContain(':')
  })

  test('asreproast without credentials (no-creds AS-REP roast)', () => {
    // GetNPUsers.py -no-pass: works for accounts with pre-auth disabled
    const r = schema.safeParse({
      action: 'asreproast',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.username).toBeUndefined()
      expect(r.data.password).toBeUndefined()
    }
  })

  test('RBCD setup for lateral movement to specific target computer', () => {
    const r = schema.safeParse({
      action: 'rbcd_setup',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
      username: 'attacker-computer$',
      password: 'MachinePass1',
      target_computer: 'victim-server',
      attacker_computer: 'attacker-machine',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.action).toBe('rbcd_setup')
      expect(r.data.target_computer).toBe('victim-server')
    }
  })

  test('LDAP relay setup for SMB signing disabled environment', () => {
    const r = schema.safeParse({
      action: 'relay_setup',
      dc_ip: '10.0.0.1',
      domain: 'corp.local',
      relay_type: 'ldap',
      relay_target: '10.0.0.10',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.relay_type).toBe('ldap')
      expect(r.data.relay_target).toBe('10.0.0.10')
    }
  })
})
