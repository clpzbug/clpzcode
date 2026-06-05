import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { CRED_HARVEST_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

// ── Patterns ──────────────────────────────────────────────────────────────────

type PatternDef = {
  regex: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low'
}

const SCAN_PATTERNS: PatternDef[] = [
  // Passwords / secrets
  { regex: 'password\\s*[=:]\\s*[\'"]?[^\\s\'"]{4,}', category: 'password', severity: 'high' },
  { regex: 'passwd\\s*[=:]\\s*[\'"]?[^\\s\'"]{4,}', category: 'password', severity: 'high' },
  // AWS
  { regex: 'AKIA[0-9A-Z]{16}', category: 'aws_key', severity: 'critical' }, // literal key prefix pattern
  { regex: 'aws_access_key_id\\s*[=:]\\s*[A-Z0-9]{20}', category: 'aws_key', severity: 'critical' },
  { regex: 'aws_secret\\s*[=:]\\s*[^\\s\'"]{20,}', category: 'aws_secret', severity: 'critical' },
  // SSH / PGP private keys
  { regex: '-----BEGIN [A-Z ]* PRIVATE KEY-----', category: 'private_key', severity: 'critical' },
  // DB connection strings
  { regex: 'DATABASE_URL\\s*[=:]\\s*[^\\s\'"]+', category: 'db_url', severity: 'critical' },
  { regex: '(mysql|postgres|postgresql|mongodb|redis|mssql|oracle)://[^:@]+:[^@]+@', category: 'db_url', severity: 'critical' },
  // GitHub tokens (multiple formats)
  { regex: 'ghp_[A-Za-z0-9]{36}', category: 'github_token', severity: 'high' },
  { regex: 'github_token\\s*[=:]\\s*[^\\s\'"]+', category: 'github_token', severity: 'high' },
  // OpenAI / Anthropic
  { regex: 'sk-[A-Za-z0-9]{48}', category: 'openai_key', severity: 'critical' },
  { regex: 'sk-ant-[A-Za-z0-9\\-_]{40,}', category: 'anthropic_key', severity: 'critical' },
  // JWT secrets in .env / config
  { regex: 'JWT_SECRET\\s*[=:]\\s*[^\\s\'"]{8,}', category: 'jwt_secret', severity: 'critical' },
  { regex: 'jwt[._-]secret\\s*[=:]\\s*[^\\s\'"]{8,}', category: 'jwt_secret', severity: 'critical' },
]

const DEEP_PATTERNS: PatternDef[] = [
  ...SCAN_PATTERNS,
  { regex: 'api[_-]?key\\s*[=:]\\s*[\'"]?[^\\s\'"]{8,}', category: 'api_key', severity: 'medium' },
  { regex: 'secret[_-]?key?\\s*[=:]\\s*[\'"]?[^\\s\'"]{8,}', category: 'secret_key', severity: 'high' },
  { regex: 'token\\s*[=:]\\s*[\'"]?[A-Za-z0-9._\\-]{16,}', category: 'token', severity: 'medium' },
  { regex: 'REDIS_URL\\s*[=:]\\s*[^\\s\'"]+', category: 'redis_url', severity: 'high' },
  { regex: 'private_key\\s*[=:]\\s*[\'"]?[^\\s\'"]{8,}', category: 'private_key', severity: 'critical' },
  { regex: 'client_secret\\s*[=:]\\s*[\'"]?[^\\s\'"]{8,}', category: 'oauth_secret', severity: 'high' },
  { regex: 'STRIPE_[A-Z_]*KEY\\s*[=:]\\s*[^\\s\'"]+', category: 'stripe_key', severity: 'critical' },
  // NPM / CI/CD tokens
  { regex: 'npm_[A-Za-z0-9]{36}', category: 'npm_token', severity: 'high' },
  { regex: 'CIRCLE_TOKEN\\s*[=:]\\s*[^\\s\'"]+', category: 'ci_token', severity: 'high' },
  { regex: 'TRAVIS_TOKEN\\s*[=:]\\s*[^\\s\'"]+', category: 'ci_token', severity: 'high' },
  // Slack / Discord / Telegram
  { regex: 'xox[bp]-[0-9A-Za-z\\-]+', category: 'slack_token', severity: 'high' },
  { regex: 'SLACK_[A-Z_]*TOKEN\\s*[=:]\\s*[^\\s\'"]+', category: 'slack_token', severity: 'high' },
  { regex: 'DISCORD_TOKEN\\s*[=:]\\s*[^\\s\'"]+', category: 'discord_token', severity: 'high' },
  { regex: 'TELEGRAM_BOT_TOKEN\\s*[=:]\\s*[^\\s\'"]+', category: 'telegram_token', severity: 'medium' },
  // Cloud SaaS keys
  { regex: 'SENDGRID_API_KEY\\s*[=:]\\s*[^\\s\'"]+', category: 'sendgrid_key', severity: 'high' },
  { regex: 'TWILIO_[A-Z_]*TOKEN\\s*[=:]\\s*[^\\s\'"]+', category: 'twilio_token', severity: 'high' },
  { regex: 'MAILGUN_[A-Z_]*KEY\\s*[=:]\\s*[^\\s\'"]+', category: 'mailgun_key', severity: 'medium' },
  // GCP Service Account (JSON key file)
  { regex: '"private_key_id"\\s*:\\s*"[a-f0-9]{40}"', category: 'gcp_service_account', severity: 'critical' },
  { regex: '"client_email"\\s*:\\s*"[^@]+@[^.]+\\.iam\\.gserviceaccount\\.com"', category: 'gcp_service_account', severity: 'critical' },
  // Shell history patterns (plaintext commands with embedded credentials)
  { regex: '-p\\s+[\'"]?[A-Za-z0-9!@#$%^&*]{6,}', category: 'cli_password', severity: 'high' }, // mysql -p pass, sshpass -p, etc.
  { regex: 'sshpass\\s+-p\\s+\\S+', category: 'ssh_password', severity: 'critical' },
  { regex: 'curl\\s+.*-u\\s+[\\w.]+:[^\\s\'"]+', category: 'curl_credentials', severity: 'high' }, // curl -u user:pass
  { regex: 'export\\s+[A-Z_]{3,}=\\S{8,}', category: 'exported_secret', severity: 'medium' }, // export API_KEY=xyz
  // Kubernetes secrets and kubeconfig
  { regex: 'kubernetes\\.io/service-account-token', category: 'k8s_token', severity: 'critical' },
  { regex: '"token"\\s*:\\s*"[A-Za-z0-9._\\-]{40,}"', category: 'k8s_token', severity: 'critical' }, // k8s SA token in kubeconfig
  { regex: 'client-certificate-data\\s*:\\s*[A-Za-z0-9+/=]{20,}', category: 'k8s_cert', severity: 'critical' }, // kubeconfig cert data
  // AWS credential files (~/.aws/credentials)
  { regex: 'aws_access_key_id\\s*=\\s*AKIA[A-Z0-9]{16}', category: 'aws_key', severity: 'critical' }, // ~/.aws/credentials format
  { regex: 'aws_secret_access_key\\s*=\\s*[A-Za-z0-9+/]{40}', category: 'aws_secret', severity: 'critical' },
  // HashiCorp Vault / other secret managers
  { regex: 'VAULT_TOKEN\\s*[=:]\\s*[^\\s\'"]+', category: 'vault_token', severity: 'critical' },
  { regex: 's\\.(?:[A-Za-z0-9]{24,})', category: 'vault_token', severity: 'critical' }, // Vault root token format
  // Azure Service Principal (client_secret + client_id)
  { regex: 'AZURE_CLIENT_SECRET\\s*[=:]\\s*[^\\s\'"]+', category: 'azure_secret', severity: 'critical' },
  { regex: 'AZURE_CLIENT_ID\\s*[=:]\\s*[0-9a-f-]{36}', category: 'azure_client', severity: 'high' },
  { regex: '"clientSecret"\\s*:\\s*"[^"]{8,}"', category: 'azure_secret', severity: 'critical' },
  // GitLab tokens
  { regex: 'glpat-[A-Za-z0-9\\-_]{20}', category: 'gitlab_token', severity: 'critical' },
  { regex: 'GITLAB_TOKEN\\s*[=:]\\s*[^\\s\'"]+', category: 'gitlab_token', severity: 'high' },
  // Jenkins API token (alphanumeric 128-bit)
  { regex: 'jenkins[._-]?(?:token|api[._-]?key)\\s*[=:]\\s*[^\\s\'"]{16,}', category: 'jenkins_token', severity: 'high' },
  // Docker registry credentials
  { regex: '"auth"\\s*:\\s*"[A-Za-z0-9+/=]{16,}"', category: 'docker_auth', severity: 'high' }, // ~/.docker/config.json
  { regex: 'DOCKER_PASSWORD\\s*[=:]\\s*[^\\s\'"]+', category: 'docker_password', severity: 'high' },
]

const PRIORITY_EXTENSIONS = [
  '.env', '.conf', '.yaml', '.yml', '.json', '.properties',
  '.ini', '.cfg', '.toml', '.xml', '.php', '.py', '.rb',
  '.sh', '.bash', '.zsh', '.fish', // shell scripts often embed credentials
  '.pem', '.key', '.ppk', '.ovpn', // private keys and VPN configs
  '.txt', '.log', // plaintext notes and logs sometimes contain passwords
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskValue(line: string): string {
  return line.replace(
    /([=:]\s*['"]?)([A-Za-z0-9+/._\-]{4,})/g,
    (_m, prefix, val) => {
      const visible = val.substring(0, Math.min(4, Math.floor(val.length / 3)))
      return `${prefix}${visible}${'*'.repeat(Math.min(8, val.length - visible.length))}`
    },
  )
}

function limitPreview(s: string, max = 120): string {
  return s.length > max ? `${s.substring(0, max)}…` : s
}

type Finding = {
  file: string
  line: number
  pattern: string
  match_preview: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
}

async function grepPattern(
  basePath: string,
  patternDef: PatternDef,
  maxDepth: number,
  extFilter: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Finding[]> {
  const args: string[] = ['-r', '-n', '-E', '-i', '--binary-files=without-match']

  const exts = extFilter.length > 0 ? extFilter : PRIORITY_EXTENSIONS
  for (const ext of exts) {
    args.push(`--include=*${ext}`)
  }

  args.push(`--max-depth=${maxDepth}`)
  args.push('--', patternDef.regex, basePath)

  try {
    const { stdout } = await execFileAsync('/usr/bin/grep', args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      signal,
    })

    const findings: Finding[] = []
    for (const rawLine of stdout.split('\n')) {
      const trimmed = rawLine.trim()
      if (!trimmed) continue

      const colonIdx = trimmed.indexOf(':')
      if (colonIdx < 0) continue
      const afterFile = trimmed.substring(colonIdx + 1)
      const numIdx = afterFile.indexOf(':')
      if (numIdx < 0) continue

      const file = trimmed.substring(0, colonIdx)
      const lineNumStr = afterFile.substring(0, numIdx)
      const content = afterFile.substring(numIdx + 1)
      const lineNum = parseInt(lineNumStr, 10)

      if (isNaN(lineNum)) continue

      findings.push({
        file,
        line: lineNum,
        pattern: patternDef.regex,
        match_preview: limitPreview(maskValue(content.trim())),
        severity: patternDef.severity,
        category: patternDef.category,
      })
    }
    return findings
  } catch {
    return []
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const inputSchema = lazySchema(() =>
  z.object({
    path: z.string().default('/').describe('Base directory to search'),
    patterns: z
      .array(z.string())
      .optional()
      .describe('Custom regex patterns to search for'),
    depth: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe('Max search depth'),
    extensions: z
      .array(z.string())
      .optional()
      .describe('File extensions to include (e.g. [".env", ".conf", ".yaml"])'),
    action: z
      .enum(['scan', 'deep'])
      .default('scan')
      .describe('scan=quick high-signal patterns, deep=thorough with more patterns'),
    timeout_secs: z
      .number()
      .int()
      .min(10)
      .max(600)
      .default(120)
      .describe('Timeout in seconds'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    path: z.string(),
    action: z.string(),
    total_findings: z.number(),
    findings: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        pattern: z.string(),
        match_preview: z.string(),
        severity: z.enum(['critical', 'high', 'medium', 'low']),
        category: z.string(),
      }),
    ),
    files_scanned: z.number(),
    error: z.string().optional(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// ── Tool ──────────────────────────────────────────────────────────────────────

export const CredHarvestTool = buildTool({
  name: CRED_HARVEST_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'credharvest — find hardcoded passwords, API keys, tokens, secrets in filesystem',
  maxResultSizeChars: 40_000,

  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.action ?? 'scan'}: ${i.path ?? '/'}`
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
    return i?.action ? `CredHarvest:${i.action}` : CRED_HARVEST_TOOL_NAME
  },

  isConcurrencySafe() {
    return true
  },

  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `cred-harvest ${i?.action ?? 'scan'} ${i?.path ?? '/'}`
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
    return `CredHarvest ${i?.action ?? 'scan'}: ${i?.path ?? '/'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `CredHarvest ${i.action ?? 'scan'}: ${i.path ?? '/'}`
  },
  renderToolResultMessage,

  async call(input, context) {
    const signal = context.abortController.signal
    const { path, action, depth, extensions, patterns: extraPatterns, timeout_secs } = input
    const timeoutMs = timeout_secs * 1000

    const basePatterns = action === 'deep' ? DEEP_PATTERNS : SCAN_PATTERNS
    const customPatternDefs: PatternDef[] = (extraPatterns ?? []).map(p => ({
      regex: p,
      category: 'custom',
      severity: 'medium' as const,
    }))
    const allPatterns = [...basePatterns, ...customPatternDefs]
    const extFilter = extensions ?? []
    const perPatternTimeout = Math.max(Math.floor(timeoutMs / allPatterns.length), 5_000)

    const allFindings: Finding[] = []
    const seenKeys = new Set<string>()

    for (const patternDef of allPatterns) {
      const found = await grepPattern(path, patternDef, depth, extFilter, perPatternTimeout, signal)
      for (const f of found) {
        const key = `${f.file}:${f.line}:${f.category}`
        if (!seenKeys.has(key)) {
          seenKeys.add(key)
          allFindings.push(f)
        }
      }
    }

    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    allFindings.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3))

    const distinctFiles = new Set(allFindings.map(f => f.file)).size

    return {
      data: {
        path,
        action,
        total_findings: allFindings.length,
        findings: allFindings.slice(0, 500),
        files_scanned: distinctFiles,
      },
    }
  },

  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `CredHarvest error: ${content.error}`,
      }
    }

    const lines: string[] = [
      `CredHarvest ${content.action}: ${content.path}`,
      `Findings: ${content.total_findings}  Files with secrets: ${content.files_scanned}`,
      '',
    ]

    const bySeverity: Record<string, Finding[]> = {}
    for (const f of content.findings) {
      if (!bySeverity[f.severity]) bySeverity[f.severity] = []
      bySeverity[f.severity].push(f)
    }

    for (const sev of ['critical', 'high', 'medium', 'low'] as const) {
      const group = bySeverity[sev]
      if (!group || group.length === 0) continue
      lines.push(`[${sev.toUpperCase()}] (${group.length})`)
      for (const f of group.slice(0, 20)) {
        lines.push(`  ${f.file}:${f.line} [${f.category}]`)
        lines.push(`    ${f.match_preview}`)
      }
      if (group.length > 20) lines.push(`  … and ${group.length - 20} more`)
      lines.push('')
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)

// Exported for testing only
export const __test = { maskValue, limitPreview, SCAN_PATTERNS, DEEP_PATTERNS, PRIORITY_EXTENSIONS }
