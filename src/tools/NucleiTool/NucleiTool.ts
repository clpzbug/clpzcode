import { mkdtemp, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runNativeWithTask } from '../../utils/task/nativeTaskRunner.js'
import { NUCLEI_TOOL_NAME, PROFILE_MAP, TEMPLATE_SHORTCUT_MAP } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const

const PROFILES = [
  'pentest', 'recommended', 'cves', 'kev', 'default-login', 'misconfigs',
  'wordpress', 'cloud', 'compliance', 'windows', 'osint', 'takeovers',
  'priv-esc', 'ai', 'all',
  // Cloud-provider specific profiles
  'aws', 'gcp', 'azure', 'alibaba', 'k8s',
] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    targets: z
      .array(z.string())
      .min(1)
      .describe('Target URLs or IPs to scan (e.g. ["https://target.com","10.0.0.1"])'),
    profile: z
      .enum(PROFILES)
      .optional()
      .describe(
        'Use a curated profile: pentest|recommended|cves|kev|default-login|misconfigs|wordpress|cloud|compliance|windows|osint|takeovers|priv-esc|ai|all',
      ),
    templates: z
      .array(z.string())
      .optional()
      .describe(
        'Template shortcuts or absolute paths (e.g. ["http/cves","http/vulnerabilities","dast/vulnerabilities"]). Shortcuts: http/cves, http/vulnerabilities, http/exposures, http/misconfiguration, http/default-logins, http/exposed-panels, http/technologies, http/takeovers, http/fuzzing, dast, network/cves, ssl, dns, cloud, javascript, headless, file/keys',
      ),
    tags: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by nuclei tags (e.g. ["rce","sqli","xss","lfi","ssrf","cve","default-login","misconfig"])',
      ),
    exclude_tags: z
      .array(z.string())
      .optional()
      .describe('Exclude templates with these tags (e.g. ["dos","fuzz","osint","info"])'),
    severity: z
      .array(z.enum(SEVERITIES))
      .optional()
      .describe('Filter by severity: info|low|medium|high|critical. Default: medium,high,critical'),
    rate_limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(150)
      .describe('Max requests per second (default: 150)'),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe('Number of parallel template executions (default: 25)'),
    timeout: z
      .number()
      .int()
      .min(1)
      .max(120)
      .default(10)
      .describe('Per-request timeout in seconds (default: 10)'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe('Custom HTTP headers to add to requests (e.g. {"Authorization":"Bearer token"})'),
    proxy: z
      .string()
      .optional()
      .describe('Proxy URL (e.g. "http://127.0.0.1:8080")'),
    no_interactsh: z
      .boolean()
      .default(false)
      .describe(
        'Disable interactsh OOB server (faster, use in air-gapped environments or when callbacks are blocked)',
      ),
    auto_scan: z
      .boolean()
      .default(false)
      .describe(
        '-as: automatic technology detection via wappalyzer and run matching templates automatically',
      ),
    new_templates_only: z
      .boolean()
      .default(false)
      .describe('-nt: run only templates added in the latest nuclei-templates release'),
    timeout_secs: z
      .number()
      .int()
      .min(30)
      .max(7200)
      .default(600)
      .describe('Total scan timeout in seconds (default: 600)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const NucleiFindingSchema = z.object({
  template_id: z.string(),
  template_name: z.string(),
  severity: z.string(),
  type: z.string(),
  host: z.string(),
  matched_url: z.string(),
  matcher_name: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()),
  extracted_results: z.array(z.string()).optional(),
  curl_command: z.string().optional(),
  timestamp: z.string(),
})

const outputSchema = lazySchema(() =>
  z.object({
    findings: z.array(NucleiFindingSchema),
    total: z.number(),
    by_severity: z.object({
      critical: z.number(),
      high: z.number(),
      medium: z.number(),
      low: z.number(),
      info: z.number(),
    }),
    templates_run: z.number(),
    duration_secs: z.number(),
    command: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>
export type NucleiFinding = z.infer<typeof NucleiFindingSchema>

function resolveTemplate(t: string): string {
  return TEMPLATE_SHORTCUT_MAP[t] ?? t
}

function buildArgs(input: z.infer<InputSchema>, outputFile: string): string[] {
  const args: string[] = []

  // Targets
  for (const target of input.targets) {
    args.push('-u', target)
  }

  // Profile vs templates vs tags
  if (input.profile) {
    const profilePath = PROFILE_MAP[input.profile]
    if (profilePath) args.push('-profile', profilePath)
  }

  if (input.templates?.length) {
    for (const t of input.templates) {
      args.push('-t', resolveTemplate(t))
    }
  }

  if (input.tags?.length) {
    args.push('-tags', input.tags.map(t => t.replace(/[,\s]/g, '')).join(','))
  }

  if (input.exclude_tags?.length) {
    args.push('-etags', input.exclude_tags.map(t => t.replace(/[,\s]/g, '')).join(','))
  }

  // Severity
  const sev = input.severity ?? (input.profile ? undefined : ['medium', 'high', 'critical'])
  if (sev?.length) {
    args.push('-severity', sev.join(','))
  }

  // Performance
  args.push('-rl', String(input.rate_limit))
  args.push('-c', String(input.concurrency))
  args.push('-timeout', String(input.timeout))

  // Headers
  if (input.headers) {
    for (const [k, v] of Object.entries(input.headers)) {
      const safeKey = k.replace(/[\r\n]/g, '')
      const safeVal = v.replace(/[\r\n]/g, '')
      args.push('-H', `${safeKey}: ${safeVal}`)
    }
  }

  // Proxy
  if (input.proxy) {
    args.push('-proxy', input.proxy)
  }

  // OOB
  if (input.no_interactsh) {
    args.push('-ni')
  }

  // Auto scan
  if (input.auto_scan) {
    args.push('-as')
  }

  // New templates only
  if (input.new_templates_only) {
    args.push('-nt')
  }

  // Output: JSONL to temp file
  args.push('-jsonl-export', outputFile)

  // Suppress banner and status
  args.push('-silent', '-no-color')

  return args
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseOneFinding(raw: any): NucleiFinding | null {
  try {
    const info = raw['info'] ?? {}
    return {
      template_id: String(raw['template-id'] ?? raw['templateID'] ?? ''),
      template_name: String(info['name'] ?? ''),
      severity: String(info['severity'] ?? 'info'),
      type: String(raw['type'] ?? 'http'),
      host: String(raw['host'] ?? ''),
      matched_url: String(raw['matched-at'] ?? raw['url'] ?? ''),
      matcher_name: raw['matcher-name'] ? String(raw['matcher-name']) : undefined,
      description: info['description'] ? String(info['description']) : undefined,
      tags: Array.isArray(info['tags']) ? info['tags'].map(String) : [],
      extracted_results: Array.isArray(raw['extracted-results'])
        ? raw['extracted-results'].map(String)
        : undefined,
      curl_command: raw['curl-command'] ? String(raw['curl-command']) : undefined,
      timestamp: String(raw['timestamp'] ?? new Date().toISOString()),
    }
  } catch {
    return null
  }
}

async function runNuclei(input: z.infer<InputSchema>, context: ToolUseContext): Promise<Output> {
  const start = Date.now()
  const tmpDir = await mkdtemp(join(tmpdir(), 'nuclei-'))
  const outputFile = join(tmpDir, 'results.jsonl')

  try {
    const args = buildArgs(input, outputFile)
    const targets = input.targets.join(', ')

    const { stderr, code } = await runNativeWithTask({
      binary: '/usr/sbin/nuclei',
      args,
      description: `Nuclei ${input.profile ?? input.tags?.join(',') ?? 'scan'}: ${targets}`,
      command: `nuclei ${args.join(' ')}`,
      timeoutMs: input.timeout_secs * 1000,
      setAppState: context.setAppStateForTasks ?? context.setAppState,
      agentId: context.agentId,
      abortSignal: context.abortController.signal,
    })

    const command = `nuclei ${args.join(' ')}`

    // Read JSONL output
    let raw = ''
    try {
      raw = await readFile(outputFile, 'utf8')
    } catch {
      // No findings file = no results (not an error if nuclei exited cleanly)
      if (code !== 0) {
        return {
          findings: [],
          total: 0,
          by_severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          templates_run: 0,
          duration_secs: (Date.now() - start) / 1000,
          command,
          error: stderr || `nuclei exited with code ${code}`,
        }
      }
      return {
        findings: [],
        total: 0,
        by_severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        templates_run: 0,
        duration_secs: (Date.now() - start) / 1000,
        command,
      }
    }

    // Parse JSONL — one JSON object per line
    const findings: NucleiFinding[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('{')) continue
      try {
        const obj = JSON.parse(trimmed)
        const finding = parseOneFinding(obj)
        if (finding) findings.push(finding)
      } catch {
        // Skip malformed lines
      }
    }

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    for (const f of findings) {
      const sev = f.severity.toLowerCase() as keyof typeof bySeverity
      if (sev in bySeverity) bySeverity[sev]++
    }

    return {
      findings,
      total: findings.length,
      by_severity: bySeverity,
      templates_run: 0, // nuclei JSONL output doesn't include template execution count
      duration_secs: (Date.now() - start) / 1000,
      command,
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']
const SEVERITY_ICONS: Record<string, string> = {
  critical: 'CRIT',
  high:     'HIGH',
  medium:   'MED ',
  low:      'LOW ',
  info:     'INFO',
}

export const NucleiTool = buildTool({
  name: NUCLEI_TOOL_NAME,
  searchHint:
    'vulnerability scanner — 13,000+ templates for CVEs, misconfigs, default-logins, DAST, exposed panels, cloud, SSL, DNS',
  maxResultSizeChars: 300_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const targets = i.targets ?? []
    const label = i.profile ?? i.tags?.join(',') ?? 'templates'
    return targets.length > 0
      ? `Nuclei ${label}: ${targets[0]}${targets.length > 1 ? ` +${targets.length - 1}` : ''}`
      : 'Nuclei vulnerability scan'
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
    const label = i?.profile ?? i?.tags?.join(',') ?? i?.templates?.[0] ?? 'scan'
    return `Nuclei:${label}`
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `nuclei ${input.targets?.join(' ')} ${input.profile ?? ''} ${input.tags?.join(',') ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const t = input?.targets?.[0]
    const label = input?.profile ?? input?.tags?.[0] ?? 'pentest'
    return t ? `Nuclei: ${t} [${label}]` : 'Nuclei scan'
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const target = i.targets?.[0] ?? '?'
    const label = i.profile ?? i.tags?.join(',') ?? i.templates?.join(',') ?? 'scan'
    return `${target} (${label})`
  },
  renderToolResultMessage,
  async call(input, context) {
    const result = await runNuclei(input, context)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error && content.total === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Nuclei error: ${content.error}`,
      }
    }

    const lines: string[] = [
      `Nuclei scan — ${content.total} findings (${content.duration_secs.toFixed(1)}s)`,
      `Command: ${content.command}`,
      `Severity: CRIT=${content.by_severity.critical} HIGH=${content.by_severity.high} MED=${content.by_severity.medium} LOW=${content.by_severity.low} INFO=${content.by_severity.info}`,
      '',
    ]

    // Group findings by severity
    const grouped: Record<string, NucleiFinding[]> = {}
    for (const f of content.findings) {
      const sev = f.severity.toLowerCase()
      ;(grouped[sev] ??= []).push(f)
    }

    for (const sev of SEVERITY_ORDER) {
      const group = grouped[sev]
      if (!group?.length) continue
      lines.push(`${SEVERITY_ICONS[sev] ?? sev.toUpperCase()} (${group.length}):`)
      for (const f of group) {
        const extracted =
          f.extracted_results?.length ? ` → ${f.extracted_results.slice(0, 2).join(', ')}` : ''
        lines.push(`  [${f.template_id}] ${f.template_name}`)
        lines.push(`    ${f.matched_url}${extracted}`)
        if (f.description) {
          // Truncate long descriptions
          const desc = f.description.length > 120 ? f.description.slice(0, 120) + '…' : f.description
          lines.push(`    ${desc}`)
        }
        if (f.curl_command) {
          lines.push(`    curl: ${f.curl_command.split('\n')[0].slice(0, 200)}`)
        }
      }
      lines.push('')
    }

    if (content.error) lines.push(`Warning: ${content.error}`)

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
