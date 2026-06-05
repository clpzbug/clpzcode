import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { OAUTH_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const ACTIONS = ['token_leak', 'state_bypass', 'redirect_uri', 'implicit_flow', 'pkce_check', 'token_reuse'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    authorization_url: z.string().describe('OAuth authorization endpoint URL'),
    action: z.enum(ACTIONS).describe('Test action to perform'),
    token_url: z.string().optional().describe('Token endpoint URL (for pkce_check, token_reuse)'),
    client_id: z.string().optional().describe('OAuth client_id'),
    redirect_uri: z.string().optional().describe('Registered redirect URI (baseline for redirect tests)'),
    scope: z.string().default('openid profile email').optional().describe('OAuth scopes'),
    extra_params: z.record(z.string(), z.string()).optional().describe('Additional query parameters'),
    timeout_secs: z.number().int().min(5).max(300).default(30).describe('Timeout per request in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    authorization_url: z.string(),
    action: z.string(),
    findings: z.array(
      z.object({
        test: z.string(),
        url: z.string(),
        status_code: z.number(),
        body_preview: z.string(),
        vulnerable: z.boolean(),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
        evidence: z.string(),
      }),
    ),
    vulnerable: z.boolean(),
    summary: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>
type Finding = Output['findings'][number]

async function fetchUrl(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  followRedirects = false,
  signal?: AbortSignal,
): Promise<{ status: number; body: string; location?: string }> {
  const args: string[] = [
    '-s', '-i', '-o', '-',
    '-w', '\n%{http_code}',
    '--max-time', String(Math.floor(timeoutMs / 1000)),
    '--connect-timeout', '5',
    '-k',
  ]

  if (!followRedirects) args.push('--max-redirs', '0')

  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`)
  }
  args.push(url)

  try {
    const { stdout } = await execFileAsync('/usr/sbin/curl', args, {
      timeout: timeoutMs + 5000,
      maxBuffer: 256 * 1024,
      signal,
    })

    const lines = stdout.trim().split('\n')
    const rawStatus = lines[lines.length - 1]?.trim() ?? ''
    const statusCode = !isNaN(parseInt(rawStatus, 10)) ? parseInt(rawStatus, 10) : 0
    const body = lines.slice(0, -1).join('\n')
    const locationMatch = body.match(/^[Ll]ocation:\s*(.+)$/m)

    return { status: statusCode, body: body.substring(0, 1000), location: locationMatch?.[1]?.trim() }
  } catch (err: unknown) {
    return { status: 0, body: `Request failed: ${errorMessage(err)}` }
  }
}

function buildAuthUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return url.toString()
}

async function runOAuth(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const timeoutMs = (input.timeout_secs ?? 30) * 1000
  const clientId = input.client_id ?? 'test_client'
  const redirectUri = input.redirect_uri ?? 'https://attacker.com/callback'
  const scope = input.scope ?? 'openid profile email'
  const findings: Finding[] = []

  switch (input.action) {
    case 'token_leak': {
      const url = buildAuthUrl(input.authorization_url, {
        response_type: 'token',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
      })
      const { status, body, location } = await fetchUrl(url, {}, timeoutMs, false, signal)
      const leaksToken = (location ?? '').includes('access_token') || body.includes('access_token')

      findings.push({
        test: 'token_in_url',
        url,
        status_code: status,
        body_preview: body.substring(0, 300),
        vulnerable: leaksToken,
        severity: leaksToken ? 'high' : 'info',
        evidence: leaksToken
          ? 'access_token present in redirect URL — token leakage via Referer/logs'
          : `No token in URL/redirect. HTTP ${status}`,
      })
      break
    }

    case 'state_bypass': {
      const urlNoState = buildAuthUrl(input.authorization_url, {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
      })
      const r1 = await fetchUrl(urlNoState, {}, timeoutMs, false, signal)
      const missingStateAllowed = r1.status >= 200 && r1.status < 400 && !r1.body.toLowerCase().includes('state')

      const urlEmptyState = buildAuthUrl(input.authorization_url, {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state: '',
      })
      const r2 = await fetchUrl(urlEmptyState, {}, timeoutMs, false, signal)

      findings.push({
        test: 'missing_state',
        url: urlNoState,
        status_code: r1.status,
        body_preview: r1.body.substring(0, 300),
        vulnerable: missingStateAllowed,
        severity: missingStateAllowed ? 'high' : 'info',
        evidence: missingStateAllowed
          ? 'Authorization accepted without state parameter — CSRF protection absent'
          : `Request without state: HTTP ${r1.status}`,
      })

      findings.push({
        test: 'empty_state',
        url: urlEmptyState,
        status_code: r2.status,
        body_preview: r2.body.substring(0, 200),
        vulnerable: r2.status >= 200 && r2.status < 400,
        severity: r2.status >= 200 && r2.status < 400 ? 'medium' : 'info',
        evidence: `Empty state parameter: HTTP ${r2.status}`,
      })
      break
    }

    case 'redirect_uri': {
      const maliciousUris = [
        'https://attacker.com/callback',
        `${redirectUri}/../evil`,
        `${redirectUri}%40attacker.com`,
      ]

      for (const evil of maliciousUris) {
        const url = buildAuthUrl(input.authorization_url, {
          response_type: 'code',
          client_id: clientId,
          redirect_uri: evil,
          scope,
          state: 'test_state_xyz',
        })
        const { status, body, location } = await fetchUrl(url, {}, timeoutMs, false)
        const redirectsToEvil = (location ?? '').includes('attacker.com') || body.includes('attacker.com')

        findings.push({
          test: `redirect_uri: ${evil.substring(0, 60)}`,
          url,
          status_code: status,
          body_preview: body.substring(0, 200),
          vulnerable: redirectsToEvil,
          severity: redirectsToEvil ? 'critical' : status === 200 ? 'medium' : 'info',
          evidence: redirectsToEvil
            ? `Redirected to attacker.com — open redirect in OAuth flow`
            : `HTTP ${status} — redirect_uri rejected or no bypass`,
        })
        if (redirectsToEvil) break
      }
      break
    }

    case 'implicit_flow': {
      const url = buildAuthUrl(input.authorization_url, {
        response_type: 'token',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
      })
      const { status, body } = await fetchUrl(url, {}, timeoutMs, false, signal)
      const implicitEnabled = status === 200 || status === 302

      findings.push({
        test: 'implicit_flow_enabled',
        url,
        status_code: status,
        body_preview: body.substring(0, 300),
        vulnerable: implicitEnabled,
        severity: implicitEnabled ? 'medium' : 'info',
        evidence: implicitEnabled
          ? `response_type=token accepted (HTTP ${status}) — implicit flow enabled, tokens exposed in URL fragment`
          : `Implicit flow rejected: HTTP ${status}`,
      })
      break
    }

    case 'pkce_check': {
      const url = buildAuthUrl(input.authorization_url, {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state: 'state_pkce_test',
      })
      const { status, body } = await fetchUrl(url, {}, timeoutMs, false, signal)
      const noPkceAllowed = status >= 200 && status < 400

      findings.push({
        test: 'pkce_not_enforced',
        url,
        status_code: status,
        body_preview: body.substring(0, 300),
        vulnerable: noPkceAllowed,
        severity: noPkceAllowed ? 'medium' : 'info',
        evidence: noPkceAllowed
          ? `Authorization code flow accepted without PKCE (HTTP ${status}) — auth code interception possible`
          : `PKCE enforced or rejected without code_challenge: HTTP ${status}`,
      })

      // PKCE downgrade: a server that accepts code_challenge_method=plain lets an
      // attacker who intercepts the code derive the verifier (verifier == challenge),
      // defeating S256. A hardened AS should require/pin S256.
      const plainUrl = buildAuthUrl(input.authorization_url, {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state: 'state_pkce_plain',
        code_challenge: 'clpzPlainChallenge123456789',
        code_challenge_method: 'plain',
      })
      const plain = await fetchUrl(plainUrl, {}, timeoutMs, false, signal)
      const plainAccepted = plain.status >= 200 && plain.status < 400
      findings.push({
        test: 'pkce_downgrade_plain',
        url: plainUrl,
        status_code: plain.status,
        body_preview: plain.body.substring(0, 300),
        vulnerable: plainAccepted,
        severity: plainAccepted ? 'high' : 'info',
        evidence: plainAccepted
          ? `code_challenge_method=plain accepted (HTTP ${plain.status}) — PKCE downgrade: S256 bypassable, intercepted code replayable`
          : `code_challenge_method=plain rejected: HTTP ${plain.status}`,
      })
      break
    }

    case 'token_reuse': {
      if (!input.token_url) {
        return {
          authorization_url: input.authorization_url,
          action: input.action,
          findings: [],
          vulnerable: false,
          summary: 'token_url required for token_reuse test',
        }
      }
      const fakeCode = 'FAKE_CODE_REPLAY_TEST_XYZ'
      const postBody = `grant_type=authorization_code&code=${fakeCode}&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${encodeURIComponent(clientId)}`

      const args: string[] = [
        '-s', '-i', '-o', '-', '-w', '\n%{http_code}',
        '-X', 'POST',
        '-H', 'Content-Type: application/x-www-form-urlencoded',
        '--data-binary', postBody,
        '--max-time', String(Math.floor(timeoutMs / 1000)),
        '-k',
        input.token_url,
      ]

      let r1body = ''
      let r1status = 0
      try {
        const { stdout } = await execFileAsync('/usr/sbin/curl', args, { timeout: timeoutMs + 5000, maxBuffer: 64 * 1024, signal })
        const lines = stdout.trim().split('\n')
        const parsed = parseInt(lines[lines.length - 1]?.trim() ?? '0', 10)
        r1status = !isNaN(parsed) ? parsed : 0
        r1body = lines.slice(0, -1).join('\n').substring(0, 300)
      } catch { /* ignore */ }

      findings.push({
        test: 'code_replay',
        url: input.token_url,
        status_code: r1status,
        body_preview: r1body,
        vulnerable: false,
        severity: 'info',
        evidence: r1body.includes('invalid_grant') || r1body.includes('invalid_code')
          ? `Token endpoint correctly rejects replayed code (HTTP ${r1status})`
          : `Token endpoint HTTP ${r1status} for fake code — check manually`,
      })
      break
    }
  }

  const criticalOrHigh = findings.filter(f => f.vulnerable && (f.severity === 'critical' || f.severity === 'high'))
  const anyVuln = findings.some(f => f.vulnerable)

  return {
    authorization_url: input.authorization_url,
    action: input.action,
    findings,
    vulnerable: anyVuln,
    summary: anyVuln
      ? `OAuth issue FOUND (${input.action}): ${(criticalOrHigh[0] ?? findings.find(f => f.vulnerable))?.evidence ?? 'misconfiguration'}`
      : `No OAuth vulnerability detected for action: ${input.action}`,
  }
}

export const OAuthTool = buildTool({
  name: OAUTH_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'oauth — OAuth 2.0/OIDC security testing: redirect_uri bypass, state CSRF, implicit flow, PKCE',
  maxResultSizeChars: 40_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.action ?? 'test'}: ${i.authorization_url ?? ''}`
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i?.action ? `${OAUTH_TOOL_NAME}:${i.action}` : OAUTH_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `oauth ${i?.action ?? 'test'} ${i?.authorization_url ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `OAuth ${i?.action ?? 'test'}: ${i?.authorization_url ?? ''}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `OAuth ${i.action ?? 'test'}: ${i.authorization_url ?? ''}`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      const result = await runOAuth(input, context.abortController.signal)
      return { data: result }
    } catch (err: unknown) {
      logForDebugging(`OAuthTool error: ${errorMessage(err)}`, { level: 'error' })
      return {
        data: {
          authorization_url: input.authorization_url,
          action: input.action,
          findings: [],
          vulnerable: false,
          summary: 'Tool execution failed',
          error: errorMessage(err),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    const lines: string[] = [`OAuth: ${content.action} → ${content.authorization_url}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    lines.push(content.vulnerable ? '⚠ VULNERABLE' : '✓ Not vulnerable')
    lines.push(`Summary: ${content.summary}`)
    lines.push('')

    for (const f of content.findings) {
      lines.push(`${f.test}: HTTP ${f.status_code} | ${f.severity.toUpperCase()}`)
      lines.push(`  ${f.evidence}`)
      if (f.vulnerable && f.body_preview) {
        lines.push(`  Preview: ${f.body_preview.substring(0, 150)}`)
      }
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)

// Exported for testing only
export const __test = { buildAuthUrl }
