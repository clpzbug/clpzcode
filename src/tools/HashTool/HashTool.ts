import { execFile, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { writeFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { HASH_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const SECLISTS = '/usr/share/seclists'
const WORDLIST_MAP: Record<string, string> = {
  rockyou: `${SECLISTS}/Passwords/Leaked-Databases/rockyou.txt.gz`,
  'common-pass': `${SECLISTS}/Passwords/Common-Credentials/10-million-password-list-top-1000000.txt`,
  fast: `${SECLISTS}/Passwords/Common-Credentials/10-million-password-list-top-1000.txt`, // ~1000 most common, good for quick NTLM spray
  ntlm: `${SECLISTS}/Passwords/Common-Credentials/10-million-password-list-top-1000000.txt`, // alias — useful mnemonic for AD hash cracking
}

function resolveWordlist(w: string): string {
  return WORDLIST_MAP[w.toLowerCase()] ?? w
}

const OPERATIONS = ['identify', 'crack_john', 'crack_hashcat'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    operation: z.enum(OPERATIONS).describe('identify | crack_john | crack_hashcat'),
    hash: z.string().describe('Hash string to identify or crack'),
    hash_type: z
      .string()
      .optional()
      .describe('Hashcat mode number (e.g. "0"=MD5, "100"=SHA1, "1000"=NTLM, "1800"=sha512crypt)'),
    wordlist: z
      .string()
      .optional()
      .describe('Wordlist shortcut (rockyou, common-pass) or absolute path'),
    rules: z.string().optional().describe('Rule file name (e.g. best64) or absolute path'),
    extra_args: z.string().optional().describe('Additional raw arguments'),
    timeout_secs: z
      .number()
      .int()
      .min(10)
      .max(3600)
      .default(300)
      .describe('Timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    operation: z.string(),
    hash: z.string(),
    identified_types: z.array(z.string()).optional(),
    cracked: z.boolean().optional(),
    plaintext: z.string().optional(),
    elapsed_secs: z.number(),
    output: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function identifyHash(hash: string, signal?: AbortSignal): Promise<Output> {
  const start = Date.now()
  // Primary: hashcat --identify (always available, returns structured mode list)
  try {
    const { stdout } = await execFileAsync(
      '/usr/sbin/hashcat',
      ['--identify', '--quiet', hash],
      { timeout: 15_000, signal },
    )
    // hashcat --identify output: "# | Name | Category" table lines
    const types = stdout
      .split('\n')
      .filter(l => /^\s*\d+\s*\|/.test(l)) // lines like "  0 | MD5 | Raw Hash"
      .map(l => {
        const parts = l.split('|').map(s => s.trim())
        return parts.length >= 2 ? `${parts[1]} (hashcat mode ${parts[0]})` : l.trim()
      })
      .filter(Boolean)

    if (types.length > 0) {
      return {
        operation: 'identify',
        hash,
        identified_types: types,
        elapsed_secs: (Date.now() - start) / 1000,
        output: stdout.trim(),
      }
    }
    // hashcat returned no matches — fall through to manual patterns
  } catch {
    // hashcat failed — fall through to manual patterns
  }

  // Fallback: regex pattern matching for common pentest hashes
  const patterns: [RegExp, string][] = [
      // Windows/AD hashes (from secretsdump, Mimikatz, hashdump) — check BEFORE generic MD5
      [/^[a-f0-9]{32}:[a-f0-9]{32}$/i, 'NTLM (from secretsdump LM:NTLM format, use the 32-char NTLM part — hashcat mode 1000)'],
      [/^[a-f0-9]{32}$/i, 'NTLM or MD5 (hashcat mode 1000 for NTLM from Windows, mode 0 for MD5)'],
      [/^\$NT\$[a-f0-9]{32}$/i, 'NTLM with $NT$ prefix (hashcat mode 1000, strip $NT$)'],
      // NTLMv2 (net-ntlmv2 from responder)
      [/^[^:]+::[^:]+:[a-f0-9]{16}:[a-f0-9]{32}:[a-f0-9]+$/i, 'NTLMv2 (from Responder/Inveigh — hashcat mode 5600)'],
      // Kerberos hashes (from GetUserSPNs/GetNPUsers)
      [/^\$krb5tgs\$23\$/, 'Kerberos TGS-REP (Kerberoast — hashcat mode 13100)'],
      [/^\$krb5asrep\$23\$/, 'Kerberos AS-REP (AS-REP Roast — hashcat mode 18200)'],
      // Unix hashes
      [/^\$apr1\$/, 'MD5(APR) — Apache .htpasswd (hashcat mode 1600)'],
      [/^\$1\$/, 'MD5(Unix) — Linux /etc/shadow (hashcat mode 500)'],
      [/^\$6\$/, 'SHA512(Unix) — Linux /etc/shadow (hashcat mode 1800)'],
      [/^\$5\$/, 'SHA256(Unix) — Linux /etc/shadow (hashcat mode 7400)'],
      [/^\$y\$/, 'yescrypt — modern Linux /etc/shadow (hashcat mode 25600 or john --format=crypt)'],
      [/^\$2[aby]\$/, 'bcrypt — web apps (hashcat mode 3200, GPU slow)'],
      // Standard hex hashes
      [/^[a-f0-9]{40}$/i, 'SHA1 (hashcat mode 100)'],
      [/^[a-f0-9]{64}$/i, 'SHA256 (hashcat mode 1400)'],
      [/^[a-f0-9]{96}$/i, 'SHA384 (hashcat mode 10800)'],
      [/^[a-f0-9]{128}$/i, 'SHA512 (hashcat mode 1700)'],
      // Other
      [/^[a-f0-9]{32}:[a-f0-9]+$/i, 'MD5 with salt (hashcat mode 10)'],
      [/^\S{13}$/, 'DES crypt (hashcat mode 1500)'],
  ]

  const identified = patterns
    .filter(([re]) => re.test(hash))
    .map(([, name]) => name)

  return {
    operation: 'identify',
    hash,
    identified_types: identified.length > 0 ? identified : ['Unknown hash format'],
    elapsed_secs: (Date.now() - start) / 1000,
  }
}

async function crackWithJohn(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const start = Date.now()
  const tmpDir = await mkdtemp(join(tmpdir(), 'hash-'))

  try {
    const hashFile = join(tmpDir, 'hash.txt')
    await writeFile(hashFile, input.hash + '\n')

    const args: string[] = []
    if (input.hash_type) {
      args.push(`--format=${input.hash_type}`)
    }
    if (input.wordlist) {
      args.push(`--wordlist=${resolveWordlist(input.wordlist)}`)
    }
    if (input.rules) {
      args.push(`--rules=${input.rules}`)
    }
    if (input.extra_args) {
      args.push(...input.extra_args.split(/\s+/).filter(Boolean))
    }
    args.push(hashFile)

    let stdout = ''
    let stderr = ''
    try {
      const result = await execFileAsync('/usr/sbin/john', args, {
        timeout: input.timeout_secs * 1000,
        maxBuffer: 10 * 1024 * 1024,
        signal,
      })
      stdout = result.stdout
      stderr = result.stderr
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string }
      stdout = e.stdout ?? ''
      stderr = e.stderr ?? ''
    }

    // Show results
    const showResult = await execFileAsync('/usr/sbin/john', ['--show', hashFile], {
      timeout: 5000,
      signal,
    }).catch(() => ({ stdout: '' }))

    const showOut = showResult.stdout.trim()
    const cracked = showOut.includes(':') && !showOut.startsWith('0 password hashes cracked')
    let plaintext: string | undefined

    if (cracked) {
      const match = showOut.match(/^[^:]+:(.+?)(?:\s*\(|$)/m)
      if (match) plaintext = match[1].trim()
    }

    return {
      operation: 'crack_john',
      hash: input.hash,
      cracked,
      plaintext,
      elapsed_secs: (Date.now() - start) / 1000,
      output: [stdout, stderr, showOut].filter(Boolean).join('\n').trim(),
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

async function crackWithHashcat(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const start = Date.now()
  const tmpDir = await mkdtemp(join(tmpdir(), 'hash-'))

  try {
    const hashFile = join(tmpDir, 'hash.txt')
    const potFile = join(tmpDir, 'hashcat.pot')
    await writeFile(hashFile, input.hash + '\n')

    const wordlistPath = resolveWordlist(input.wordlist ?? 'rockyou')
    const args: string[] = [
      '-m', input.hash_type ?? '0',
      '-a', '0', // dictionary attack
      '--potfile-path', potFile,
      '--status',
      '--quiet',
      '-w', '1', // workload profile 1 (low)
    ]

    if (input.rules) {
      const rulesPath = input.rules.startsWith('/')
        ? input.rules
        : `/usr/share/hashcat/rules/${input.rules}.rule`
      args.push('-r', rulesPath)
    }

    if (input.extra_args) {
      args.push(...input.extra_args.split(/\s+/).filter(Boolean))
    }

    args.push(hashFile, wordlistPath)

    let stdout = ''
    let stderr = ''
    try {
      const result = await execFileAsync('/usr/sbin/hashcat', args, {
        timeout: input.timeout_secs * 1000,
        maxBuffer: 10 * 1024 * 1024,
        signal,
      })
      stdout = result.stdout
      stderr = result.stderr
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number }
      stdout = e.stdout ?? ''
      stderr = e.stderr ?? ''
      // hashcat exits 1 on "exhausted" which is normal
    }

    // Read potfile for cracked results
    let plaintext: string | undefined
    let cracked = false
    try {
      const pot = execFileSync('/usr/sbin/hashcat', ['--show', '-m', input.hash_type ?? '0', hashFile], {
        timeout: 5000,
        encoding: 'utf8',
      }).trim()
      if (pot && pot.includes(':')) {
        cracked = true
        const idx = pot.indexOf(':')
        plaintext = pot.substring(idx + 1)
      }
    } catch {
      // fall back to parsing stdout
      const match = stdout.match(/[a-f0-9*]+:(.+)/)
      if (match) {
        cracked = true
        plaintext = match[1]
      }
    }

    return {
      operation: 'crack_hashcat',
      hash: input.hash,
      cracked,
      plaintext,
      elapsed_secs: (Date.now() - start) / 1000,
      output: [stdout, stderr].filter(Boolean).join('\n').trim(),
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

async function runHash(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  // Validate SecLists path when a shortcut wordlist is used for cracking
  if (input.operation !== 'identify' && input.wordlist && WORDLIST_MAP[input.wordlist.toLowerCase()] && !existsSync(SECLISTS)) {
    return {
      operation: input.operation,
      hash: input.hash,
      cracked: false,
      elapsed_secs: 0,
      error: `SecLists not found at ${SECLISTS}. Install with: sudo apt install seclists`,
    }
  }

  switch (input.operation) {
    case 'identify':
      return identifyHash(input.hash, signal)
    case 'crack_john':
      return crackWithJohn(input, signal)
    case 'crack_hashcat':
      return crackWithHashcat(input, signal)
  }
}

export const HashTool = buildTool({
  name: HASH_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'hash — identify hash type or crack hashes with john/hashcat and SecLists wordlists',
  maxResultSizeChars: 50_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const op = i.operation ?? 'identify'
    const h = i.hash ? ` ${i.hash.substring(0, 16)}...` : ''
    return `Hash ${op}${h}`
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
    return i?.operation ? `Hash:${i.operation}` : 'Hash'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `hash ${input.operation} ${input.hash?.substring(0, 16) ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const op = input?.operation ?? 'identify'
    return `Hash ${op}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.operation ?? 'identify'}: ${i.hash?.substring(0, 20) ?? ''}...`
  },
  renderToolResultMessage,
  async call(input, context) {
    const result = await runHash(input, context.abortController.signal)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: `Hash error: ${content.error}` }
    }

    const lines: string[] = [`Hash ${content.operation} (${content.elapsed_secs.toFixed(1)}s)`, '']

    if (content.operation === 'identify' && content.identified_types) {
      lines.push(`Hash: ${content.hash}`)
      lines.push('Identified types:')
      for (const t of content.identified_types) lines.push(`  ${t}`)
    } else {
      lines.push(`Hash: ${content.hash}`)
      lines.push(`Cracked: ${content.cracked ? 'YES' : 'NO'}`)
      if (content.plaintext) lines.push(`Plaintext: ${content.plaintext}`)
    }

    if (content.output) {
      lines.push('')
      lines.push('Output:')
      lines.push(content.output.split('\n').slice(0, 50).join('\n'))
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
