import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const ACTIONS = ['create', 'status', 'list', 'add_finding', 'ad_session'] as const
const SEVERITIES = ['P1', 'P2', 'P3', 'P4'] as const
const AD_SUB_ACTIONS = ['set', 'get'] as const

const schema = z.strictObject({
  action: z.enum(ACTIONS),
  target: z.string().optional(),
  scope: z.string().optional(),
  finding: z
    .object({
      title: z.string(),
      severity: z.enum(SEVERITIES),
      endpoint: z.string(),
      parameter: z.string().optional(),
      payload: z.string(),
      evidence: z.string(),
      impact: z.string(),
      vuln_class: z.string(),
    })
    .optional(),
  ad_context: z
    .object({
      sub_action: z.enum(AD_SUB_ACTIONS),
      dc_ip: z.string().optional(),
      domain: z.string().optional(),
      base_dn: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      nt_hash: z.string().optional(),
      ccache: z.string().optional(),
    })
    .optional(),
})

describe('EngagementTool schema', () => {
  test('aceita list sem target', () => {
    const r = schema.safeParse({ action: 'list' })
    expect(r.success).toBe(true)
  })

  test('aceita create com target e scope', () => {
    const r = schema.safeParse({
      action: 'create',
      target: 'example.com',
      scope: 'example.com - bug bounty - all subdomains in scope',
    })
    expect(r.success).toBe(true)
  })

  test('aceita status com target', () => {
    const r = schema.safeParse({ action: 'status', target: 'example.com' })
    expect(r.success).toBe(true)
  })

  test('aceita add_finding com finding completo', () => {
    const r = schema.safeParse({
      action: 'add_finding',
      target: 'example.com',
      finding: {
        title: 'sqli-login-form',
        severity: 'P1',
        endpoint: 'POST /login',
        parameter: 'username',
        payload: "' OR 1=1--",
        evidence: 'Response includes all users from DB',
        impact: 'Full authentication bypass, data exfiltration',
        vuln_class: 'sqli',
      },
    })
    expect(r.success).toBe(true)
  })

  test('aceita add_finding sem parameter (opcional)', () => {
    const r = schema.safeParse({
      action: 'add_finding',
      target: 'example.com',
      finding: {
        title: 'xss-search',
        severity: 'P2',
        endpoint: 'GET /search?q=XSS',
        payload: '<script>alert(1)</script>',
        evidence: 'Script executes in victim browser',
        impact: 'Session hijacking',
        vuln_class: 'xss',
      },
    })
    expect(r.success).toBe(true)
  })

  test('aceita todas as severidades de finding', () => {
    for (const severity of SEVERITIES) {
      const r = schema.safeParse({
        action: 'add_finding',
        target: 'example.com',
        finding: {
          title: 'test-finding',
          severity,
          endpoint: 'GET /test',
          payload: 'test',
          evidence: 'test evidence',
          impact: 'test impact',
          vuln_class: 'test',
        },
      })
      expect(r.success).toBe(true)
    }
  })

  test('aceita ad_session set com contexto AD', () => {
    const r = schema.safeParse({
      action: 'ad_session',
      target: 'contoso.local',
      ad_context: {
        sub_action: 'set',
        dc_ip: '10.0.0.1',
        domain: 'contoso.local',
        username: 'jdoe',
        password: 'Password1',
      },
    })
    expect(r.success).toBe(true)
  })

  test('aceita ad_session get', () => {
    const r = schema.safeParse({
      action: 'ad_session',
      target: 'contoso.local',
      ad_context: { sub_action: 'get' },
    })
    expect(r.success).toBe(true)
  })

  test('aceita ad_session com nt_hash e ccache', () => {
    const r = schema.safeParse({
      action: 'ad_session',
      target: 'contoso.local',
      ad_context: {
        sub_action: 'set',
        dc_ip: '10.0.0.1',
        domain: 'contoso.local',
        username: 'administrator',
        nt_hash: 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c',
        ccache: '/tmp/admin.ccache',
      },
    })
    expect(r.success).toBe(true)
  })

  test('aceita todas as actions', () => {
    for (const action of ACTIONS) {
      const r = schema.safeParse({ action })
      expect(r.success).toBe(true)
    }
  })

  test('rejeita sem action', () => {
    const r = schema.safeParse({ target: 'example.com' })
    expect(r.success).toBe(false)
  })

  test('rejeita action inválida', () => {
    const r = schema.safeParse({ action: 'delete' })
    expect(r.success).toBe(false)
  })

  test('rejeita finding com severity inválida', () => {
    const r = schema.safeParse({
      action: 'add_finding',
      target: 'example.com',
      finding: {
        title: 'test',
        severity: 'P5',
        endpoint: 'GET /test',
        payload: 'x',
        evidence: 'e',
        impact: 'i',
        vuln_class: 'xss',
      },
    })
    expect(r.success).toBe(false)
  })

  test('rejeita ad_context com sub_action inválido', () => {
    const r = schema.safeParse({
      action: 'ad_session',
      ad_context: { sub_action: 'update' },
    })
    expect(r.success).toBe(false)
  })

  test('rejeita finding sem campos obrigatórios', () => {
    const r = schema.safeParse({
      action: 'add_finding',
      target: 'example.com',
      finding: { title: 'test', severity: 'P1' },
    })
    expect(r.success).toBe(false)
  })
})
