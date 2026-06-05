import { mkdir, writeFile, readFile, readdir, appendFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { withFileMutex } from '../shared/fileMutationQueue.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

export const ENGAGEMENT_TOOL_NAME = 'Engagement'

const TARGETS_ROOT = join(homedir(), 'Targets')

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['create', 'status', 'list', 'add_finding', 'ad_session'])
      .describe(
        'create=new engagement, status=show current state, list=all engagements, add_finding=write finding to disk, ad_session=store/retrieve AD context (dc_ip, domain, creds) for current engagement',
      ),
    target: z
      .string()
      .optional()
      .describe('Target name/domain (required for create, status, add_finding, ad_session)'),
    scope: z
      .string()
      .optional()
      .describe('For create: scope description (in-scope domains, rules, program name)'),
    finding: z
      .object({
        title: z.string().describe('Short title, e.g. "idor-orders-api"'),
        severity: z.enum(['P1', 'P2', 'P3', 'P4']).describe('P1=critical, P2=high, P3=medium, P4=low'),
        endpoint: z.string().describe('Method + URL, e.g. "GET /api/v2/orders?id=123"'),
        parameter: z.string().optional().describe('Vulnerable parameter'),
        payload: z.string().describe('Exact payload used'),
        evidence: z.string().describe('What proves exploitability'),
        impact: z.string().describe('What an attacker gains'),
        vuln_class: z.string().describe('Vulnerability class, e.g. "idor", "sqli", "xss"'),
      })
      .optional()
      .describe('For add_finding: finding details'),
    ad_context: z
      .object({
        sub_action: z.enum(['set', 'get']).describe('set=write AD context, get=read AD context'),
        dc_ip: z.string().optional(),
        domain: z.string().optional(),
        base_dn: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        nt_hash: z.string().optional(),
        ccache: z.string().optional(),
      })
      .optional()
      .describe('For ad_session: AD context (domain controller, credentials, etc.)'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>
export type Output = { success: boolean; message: string; data?: unknown }

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
)

function safeEngagementDir(target: string): string | null {
  const resolved = resolve(TARGETS_ROOT, target)
  return resolved.startsWith(TARGETS_ROOT + '/') ? resolved : null
}

/**
 * Append an audit event to the engagement's NDJSON session log.
 * Append-only — crash-safe (each line is an atomic write).
 * Inspired by kimi-code's AgentRecord NDJSON event sourcing pattern.
 */
async function appendAuditEvent(engDir: string, action: string, data: unknown): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), action, data }) + '\n'
  const logFile = join(engDir, 'session.ndjson')
  await withFileMutex(logFile, () => appendFile(logFile, line))
}

async function runEngagement(input: Input): Promise<Output> {
  switch (input.action) {
    case 'list': {
      if (!existsSync(TARGETS_ROOT)) {
        return { success: true, message: 'No engagements yet.', data: [] }
      }
      const dirs = await readdir(TARGETS_ROOT, { withFileTypes: true })
      const targets = dirs.filter(d => d.isDirectory()).map(d => d.name)
      return { success: true, message: `${targets.length} engagement(s)`, data: targets }
    }

    case 'create': {
      if (!input.target) return { success: false, message: 'target required for create' }
      const engDir = safeEngagementDir(input.target)
      if (!engDir) return { success: false, message: 'Invalid target: path must stay within ~/Targets' }
      const findingsDir = join(engDir, 'findings')
      const evidenceDir = join(engDir, 'evidence')
      await mkdir(findingsDir, { recursive: true })
      await mkdir(evidenceDir, { recursive: true })

      const scopeContent = input.scope
        ? `# Scope: ${input.target}\n\n${input.scope}\n`
        : `# Scope: ${input.target}\n\nProgram:\nIn-scope:\nOut-of-scope:\nRules:\n`

      await writeFile(join(engDir, 'scope.md'), scopeContent)
      await writeFile(join(engDir, 'submissions.txt'), '# ID\tSeverity\tTitle\tStatus\n')
      await writeFile(join(engDir, '.gitignore'), 'evidence/\n*.har\n*.log\ncredentials*\n*.env\n')
      await appendAuditEvent(engDir, 'create', { target: input.target, scope: input.scope })

      return {
        success: true,
        message: `Engagement created: ${engDir}`,
        data: { path: engDir },
      }
    }

    case 'status': {
      if (!input.target) return { success: false, message: 'target required for status' }
      const engDir = safeEngagementDir(input.target)
      if (!engDir) return { success: false, message: 'Invalid target: path must stay within ~/Targets' }
      if (!existsSync(engDir)) {
        return { success: false, message: `Engagement not found: ${input.target}. Use action=create first.` }
      }
      const findingsDir = join(engDir, 'findings')
      const findings = existsSync(findingsDir)
        ? (await readdir(findingsDir)).filter(f => f.endsWith('.md'))
        : []
      const scope = existsSync(join(engDir, 'scope.md'))
        ? await readFile(join(engDir, 'scope.md'), 'utf8')
        : '(no scope defined)'
      return {
        success: true,
        message: `${input.target}: ${findings.length} finding(s)`,
        data: { path: engDir, findings, scope },
      }
    }

    case 'add_finding': {
      if (!input.target) return { success: false, message: 'target required for add_finding' }
      if (!input.finding) return { success: false, message: 'finding required for add_finding' }

      const engDir = safeEngagementDir(input.target)
      if (!engDir) return { success: false, message: 'Invalid target: path must stay within ~/Targets' }
      const findingsDir = join(engDir, 'findings')
      if (!existsSync(findingsDir)) {
        await mkdir(findingsDir, { recursive: true })
      }

      const existing = existsSync(findingsDir)
        ? (await readdir(findingsDir)).filter(f => f.endsWith('.md'))
        : []
      const nn = String(existing.length + 1).padStart(2, '0')
      const slug = input.finding.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const filename = `finding-${nn}-${slug}.md`
      const filepath = join(findingsDir, filename)

      const content = `## ${input.finding.vuln_class.toUpperCase()} — ${input.finding.title}
**Severity**: ${input.finding.severity}
**Endpoint**: ${input.finding.endpoint}
**Parameter**: ${input.finding.parameter ?? 'N/A'}
**Vuln class**: ${input.finding.vuln_class}

### Payload
\`\`\`
${input.finding.payload}
\`\`\`

### Evidence
${input.finding.evidence}

### Impact
${input.finding.impact}
`
      await writeFile(filepath, content)

      await appendFile(
        join(engDir, 'submissions.txt'),
        `\t${input.finding.severity}\t${input.finding.title}\topen\n`,
      )
      await appendAuditEvent(engDir, 'add_finding', {
        filename,
        severity: input.finding.severity,
        title: input.finding.title,
        vuln_class: input.finding.vuln_class,
      })

      return {
        success: true,
        message: `Finding saved: ${filepath}`,
        data: { path: filepath, filename },
      }
    }

    case 'ad_session': {
      if (!input.target) return { success: false, message: 'target required for ad_session' }
      if (!input.ad_context) return { success: false, message: 'ad_context required for ad_session' }

      const engDir = safeEngagementDir(input.target)
      if (!engDir) return { success: false, message: 'Invalid target: path must stay within ~/Targets' }
      await mkdir(engDir, { recursive: true })
      const sessionFile = join(engDir, 'ad-session.json')

      if (input.ad_context.sub_action === 'get') {
        if (!existsSync(sessionFile)) {
          return { success: false, message: `No AD session saved for ${input.target}` }
        }
        const raw = await readFile(sessionFile, 'utf8')
        const data = JSON.parse(raw) as unknown
        return { success: true, message: `AD session for ${input.target}`, data }
      }

      // sub_action === 'set'
      const { sub_action: _, ...ctx } = input.ad_context
      // Serialize concurrent writes to ad-session.json via per-path mutex
      const merged = await withFileMutex(sessionFile, async () => {
        let existing: Record<string, unknown> = {}
        if (existsSync(sessionFile)) {
          try {
            existing = JSON.parse(await readFile(sessionFile, 'utf8')) as Record<string, unknown>
          } catch {
            // ignore parse errors — overwrite
          }
        }
        const m = { ...existing, ...Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined)) }
        await writeFile(sessionFile, JSON.stringify(m, null, 2))
        return m
      })
      // Audit: log non-sensitive fields only (no password/hash)
      await appendAuditEvent(engDir, 'ad_session_set', {
        domain: ctx.domain,
        dc_ip: ctx.dc_ip,
        username: ctx.username,
        base_dn: ctx.base_dn,
      })
      return { success: true, message: `AD session saved for ${input.target}`, data: merged }
    }
  }
}

export const EngagementTool = buildTool({
  name: ENGAGEMENT_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'manage pentest/bug-bounty engagement workspace — create target, track findings, manage scope, store AD session context',
  maxResultSizeChars: 10_000,
  async description(input) {
    const i = input as Partial<Input>
    if (i.action === 'add_finding' && i.target) return `Add finding to ${i.target}`
    if (i.action === 'create' && i.target) return `Create engagement for ${i.target}`
    if (i.action === 'status' && i.target) return `Status of ${i.target}`
    if (i.action === 'ad_session' && i.target) return `AD session for ${i.target}`
    return 'Engagement workspace management'
  },
  async prompt() {
    return `Manages ~/Targets/<target>/ engagement workspaces for bug bounty and pentest engagements.

## When to call each action:
- create: FIRST call at the start of every new target. Sets up ~/Targets/<domain>/ directory structure.
- add_finding: IMMEDIATELY after confirming any vulnerability. Use for every confirmed finding (RCE, SQLi, SSRF, IDOR, etc.) with concrete evidence. Do NOT wait until the end of the engagement.
- status: Check progress and list confirmed findings.
- ad_session sub_action=set: FIRST CALL when starting AD engagement (dc_ip, domain, creds). Avoids repeating credentials in every ADRecon/ADAttack call.
- ad_session sub_action=get: Retrieve stored AD context at the start of resumed sessions.

## add_finding severity guide:
- P1 (critical): RCE, OS command execution, cloud credential theft, DCSync/domain takeover, account takeover via auth bypass
- P2 (high): SQLi with data dump, SSRF to cloud metadata, file upload webshell, ADCS ESC1 cert
- P3 (medium): IDOR read/write, JWT forgery with limited scope, reflected XSS chaining to stored
- P4 (low): Information disclosure, reflected XSS (standalone), CORS informational

## Examples:
- Start engagement: { action: "create", target: "target.com", scope: "All subdomains of target.com" }
- Record RCE: { action: "add_finding", target: "target.com", finding: { title: "ssti-rce-search", severity: "P1", endpoint: "GET /search?q=", parameter: "q", payload: "{{config.__class__.__init__.__globals__['os'].popen('id').read()}}", evidence: "uid=33(www-data) gid=33(www-data)", impact: "OS command execution as www-data", vuln_class: "ssti" } }
- Store AD creds: { action: "ad_session", target: "corp.local", ad_context: { sub_action: "set", dc_ip: "10.10.10.1", domain: "corp.local", username: "jdoe", password: "Pass123" } }`
  },
  get inputSchema() {
    return inputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  userFacingName(input) {
    const i = input as Partial<Input>
    return i?.target ? `Engagement:${i.action ?? 'manage'}:${i.target}` : `Engagement:${i?.action ?? 'manage'}`
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<{ action: string; target: string }>
    return `engagement ${i?.action ?? ''} ${i?.target ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  async call(input, _context) {
    const result = await runEngagement(input as Input)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(data: Output, toolUseID) {
    const lines: string[] = [`Engagement: ${data.success ? 'OK' : 'FAILED'} — ${data.message}`]

    if (!data.success) {
      return { tool_use_id: toolUseID, type: 'tool_result' as const, content: lines.join('\n') }
    }

    const d = data.data
    if (Array.isArray(d)) {
      // list action
      if (d.length === 0) {
        lines.push('No engagements found.')
      } else {
        lines.push('', 'Engagements:')
        d.forEach((t: unknown) => lines.push(`  ${t}`))
      }
    } else if (d && typeof d === 'object') {
      const obj = d as Record<string, unknown>
      if (obj.path) lines.push(`Path: ${obj.path}`)
      if (obj.findings && Array.isArray(obj.findings)) {
        lines.push(`Findings (${(obj.findings as unknown[]).length}):`)
        ;(obj.findings as string[]).forEach(f => lines.push(`  ${f}`))
      }
      if (obj.scope && typeof obj.scope === 'string') {
        lines.push('', '--- scope ---', obj.scope.trim())
      }
      if (obj.filename) lines.push(`File: ${obj.filename}`)
      if (obj.dc_ip || obj.domain) {
        lines.push('', 'AD context:')
        Object.entries(obj).forEach(([k, v]) => {
          if (v && k !== 'path') lines.push(`  ${k}: ${k.includes('password') || k.includes('hash') ? '***' : v}`)
        })
      }
    }

    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: lines.filter(l => l !== undefined).join('\n') }
  },
  getActivityDescription(input) {
    const i = input as Partial<Input>
    return i?.target ? `Engagement: ${i.target}` : `Engagement: ${i?.action ?? 'manage'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<Input>
    return i.target ?? i.action ?? 'engagement'
  },
  renderToolResultMessage,
} satisfies ToolDef<InputSchema, Output>)
