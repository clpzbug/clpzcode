import { existsSync } from 'fs'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import { smartTruncate } from '../shared/outputAccumulator.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runNativeWithTask } from '../../utils/task/nativeTaskRunner.js'
import { BRUTE_FORCE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const SECLISTS = '/usr/share/seclists'
const WORDLIST_MAP: Record<string, string> = {
  top100: `${SECLISTS}/Passwords/Common-Credentials/10-million-password-list-top-100.txt`,
  top1000: `${SECLISTS}/Passwords/Common-Credentials/10-million-password-list-top-1000.txt`,
  usernames: `${SECLISTS}/Usernames/top-usernames-shortlist.txt`,
  rockyou: `${SECLISTS}/Passwords/Leaked-Databases/rockyou.txt.gz`,
}

function resolve(w: string): string {
  return WORDLIST_MAP[w.toLowerCase()] ?? w
}

const SERVICES = [
  'ssh', 'ftp', 'http-get', 'http-post-form', 'https-get', 'https-post-form',
  'smb', 'telnet', 'mysql', 'mssql', 'rdp', 'vnc', 'pop3', 'smtp',
  'imap', 'ldap2', 'ldap3', 'redis', 'mongodb', 'snmp',
  'postgres', 'winrm',
] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    target: z.string().describe('Target IP or hostname'),
    service: z.enum(SERVICES).describe('Protocol/service to brute-force'),
    port: z.number().int().min(1).max(65535).optional().describe('Port number (auto-detected if omitted)'),
    username: z.string().optional().describe('Single username to try'),
    username_file: z.string().optional().describe('Username wordlist shortcut or path'),
    password: z.string().optional().describe('Single password to try'),
    password_file: z.string().optional().describe('Password wordlist shortcut or path'),
    http_path: z.string().optional().describe('HTTP path (required for http-* services)'),
    http_form_data: z
      .string()
      .optional()
      .describe('POST form data with ^USER^ and ^PASS^ tokens (for http-post-form)'),
    http_success_string: z
      .string()
      .optional()
      .describe('String indicating failed login (prepend F: to indicate failure string)'),
    threads: z.number().int().min(1).max(64).default(4).describe('Parallel threads (default: 4)'),
    extra_args: z.string().optional().describe('Additional raw hydra arguments'),
    timeout_secs: z
      .number()
      .int()
      .min(10)
      .max(3600)
      .default(300)
      .describe('Scan timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const FoundSchema = z.object({
  host: z.string(),
  port: z.number(),
  service: z.string(),
  username: z.string(),
  password: z.string(),
})

const outputSchema = lazySchema(() =>
  z.object({
    found: z.array(FoundSchema),
    total_found: z.number(),
    elapsed_secs: z.number(),
    command: z.string(),
    output: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function buildArgs(input: z.infer<InputSchema>): string[] {
  // -v = verbose (show each found credential); -V = show every attempt (too noisy for large wordlists)
  const args: string[] = ['-t', String(input.threads), '-v']

  if (input.username) {
    args.push('-l', input.username)
  } else if (input.username_file) {
    args.push('-L', resolve(input.username_file))
  } else {
    args.push('-l', 'admin') // fallback
  }

  if (input.password) {
    args.push('-p', input.password)
  } else if (input.password_file) {
    args.push('-P', resolve(input.password_file))
  } else {
    args.push('-p', 'password') // fallback
  }

  if (input.port) {
    args.push('-s', String(input.port))
  }

  if (input.extra_args) {
    args.push(...input.extra_args.split(/\s+/).filter(Boolean))
  }

  // Target and service
  const target = input.target

  if (input.service === 'http-post-form' || input.service === 'https-post-form') {
    const path = input.http_path ?? '/login'
    const formData = input.http_form_data ?? 'user=^USER^&pass=^PASS^'
    const failStr = input.http_success_string ?? 'F:Invalid'
    args.push(target, `${input.service}:${path}:${formData}:${failStr}`)
  } else if (input.service === 'http-get' || input.service === 'https-get') {
    const path = input.http_path ?? '/'
    args.push(target, `${input.service}:${path}`)
  } else {
    args.push(target, input.service)
  }

  return args
}

function parseFound(stdout: string, target: string, service: string, port: number): z.infer<typeof FoundSchema>[] {
  const found: z.infer<typeof FoundSchema>[] = []
  // Match lines like: [22][ssh] host: 10.0.0.1   login: admin   password: pass123
  const re = /\[(\d+)\]\[([^\]]+)\]\s+host:\s+(\S+)\s+login:\s+(\S+)\s+password:\s+(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stdout)) !== null) {
    found.push({
      host: m[3] ?? target,
      port: parseInt(m[1]) || port,
      service: m[2] ?? service,
      username: m[4] ?? '',
      password: m[5] ?? '',
    })
  }
  return found
}

async function runBruteForce(input: z.infer<InputSchema>, context: ToolUseContext): Promise<Output> {
  const start = Date.now()

  // Validate SecLists path when a shortcut wordlist is used
  const usesSecLists = (input.username_file && WORDLIST_MAP[input.username_file.toLowerCase()]) ||
    (input.password_file && WORDLIST_MAP[input.password_file.toLowerCase()])
  if (usesSecLists && !existsSync(SECLISTS)) {
    return {
      found: [],
      total_found: 0,
      elapsed_secs: 0,
      command: '',
      error: `SecLists not found at ${SECLISTS}. Install with: sudo apt install seclists`,
    }
  }

  const args = buildArgs(input)
  const command = `hydra ${args.join(' ')}`

  const { stdout, stderr, code } = await runNativeWithTask({
    binary: '/usr/sbin/hydra',
    args,
    description: `Hydra: ${input.service} @ ${input.target}`,
    command,
    timeoutMs: input.timeout_secs * 1000,
    setAppState: context.setAppStateForTasks ?? context.setAppState,
    agentId: context.agentId,
    abortSignal: context.abortController.signal,
  })

  if (code !== 0 && !stdout && !stderr) {
    return {
      found: [],
      total_found: 0,
      elapsed_secs: (Date.now() - start) / 1000,
      command,
      error: `hydra exited with code ${code}`,
    }
  }

  const defaultPort = input.port ?? 0
  const found = parseFound(stdout, input.target, input.service, defaultPort)

  return {
    found,
    total_found: found.length,
    elapsed_secs: (Date.now() - start) / 1000,
    command,
    output: smartTruncate([stdout, stderr].filter(Boolean).join('\n'), 10_000, { tailFallback: true }),
  }
}

export const BruteForceTool = buildTool({
  name: BRUTE_FORCE_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'brute-force — credential brute-force with hydra against SSH, HTTP, FTP, SMB and more',
  maxResultSizeChars: 100_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.target && i.service) return `Brute-force ${i.service} on ${i.target}`
    return 'Credential brute-force with hydra'
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
    return i?.service && i?.target ? `BruteForce:${i.service}:${i.target}` : 'BruteForce'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `hydra ${input.service ?? ''} ${input.target ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const svc = input?.service ?? 'brute'
    const host = input?.target ?? '?'
    return `Brute-force ${svc}://${host}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.service ?? 'brute'} @ ${i.target ?? '?'}`
  },
  renderToolResultMessage,
  async call(input, context) {
    const result = await runBruteForce(input, context)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error && content.found.length === 0) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: `BruteForce error: ${content.error}` }
    }

    const lines: string[] = [
      `Hydra scan — ${content.total_found} credential(s) found (${content.elapsed_secs.toFixed(1)}s)`,
      `Command: ${content.command}`,
      '',
    ]

    if (content.total_found > 0) {
      lines.push('FOUND CREDENTIALS:')
      for (const f of content.found) {
        lines.push(`  ${f.service}://${f.username}:${f.password}@${f.host}:${f.port}`)
      }
    } else {
      lines.push('No credentials found.')
    }

    if (content.error) lines.push(`\nWarning: ${content.error}`)

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
