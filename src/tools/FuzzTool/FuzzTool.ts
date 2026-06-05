import { mkdtemp, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runNativeWithTask } from '../../utils/task/nativeTaskRunner.js'
import { FUZZ_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const SECLISTS = '/usr/share/seclists'
const WORDLIST_MAP: Record<string, string> = {
  // Directory/file discovery
  common: `${SECLISTS}/Discovery/Web-Content/common.txt`,
  big: `${SECLISTS}/Discovery/Web-Content/big.txt`,
  medium: `${SECLISTS}/Discovery/Web-Content/directory-list-2.3-medium.txt`,
  small: `${SECLISTS}/Discovery/Web-Content/directory-list-2.3-small.txt`,
  raft: `${SECLISTS}/Discovery/Web-Content/raft-large-files.txt`,
  'raft-dirs': `${SECLISTS}/Discovery/Web-Content/raft-large-directories.txt`,
  // API / parameter discovery
  api: `${SECLISTS}/Discovery/Web-Content/api/objects.txt`,
  params: `${SECLISTS}/Discovery/Web-Content/burp-parameter-names.txt`,
  // DNS
  subdomains: `${SECLISTS}/Discovery/DNS/subdomains-top1million-20000.txt`,  // upgraded from 5k to 20k
  'subdomains-big': `${SECLISTS}/Discovery/DNS/subdomains-top1million-110000.txt`, // thorough subdomain enum
  'bounty-subs': `${SECLISTS}/Discovery/DNS/bug-bounty-program-subdomains-trickest-inventory.txt`, // bug-bounty-specific subdomains
  'dns-aggressive': `${SECLISTS}/Discovery/DNS/dns-Jhaddix.txt`, // large aggressive DNS wordlist
  vhosts: `${SECLISTS}/Discovery/DNS/namelist.txt`,
  // Security-specific wordlists
  lfi: `${SECLISTS}/Fuzzing/LFI/LFI-Jhaddix.txt`,            // LFI path traversal payloads
  backups: `${SECLISTS}/Discovery/Web-Content/Common-DB-Backups.txt`, // DB backup files
  'command-injection': `${SECLISTS}/Fuzzing/command-injection-commix.txt`, // cmdi payloads
  // API and GraphQL discovery
  'graphql': `${SECLISTS}/Discovery/Web-Content/graphql.txt`, // GraphQL endpoint discovery
  'api-endpoints': `${SECLISTS}/Discovery/Web-Content/common-api-endpoints-mazen160.txt`, // common API endpoints
  'api-wild': `${SECLISTS}/Discovery/Web-Content/api/api-seen-in-wild.txt`, // real-world API endpoints
  // URL parameter discovery (for param miner / hidden param finding)
  'url-params': `${SECLISTS}/Discovery/Web-Content/url-params_from-top-55-most-popular-apps.txt`,
  // XSS fuzzing
  'xss-poly': `${SECLISTS}/Fuzzing/XSS/robot-friendly/XSS-BruteLogic.txt`, // XSS polyglots
  // SSTI fuzzing (use as FUZZ value in ?param=FUZZ)
  'ssti': `${SECLISTS}/Fuzzing/template-engines-expression.txt`, // template engine expressions for SSTI detection
  'ssti-vars': `${SECLISTS}/Fuzzing/template-engines-special-vars.txt`, // special variables for template engine fingerprinting
  // Database fuzzing payloads
  'sqli-blind': `${SECLISTS}/Fuzzing/Databases/MySQL-Read-Local-Files.fuzzdb.txt`, // MySQL file read payloads
  // Exposed files discovery (secrets, configs, git)
  'secrets': `${SECLISTS}/Discovery/Web-Content/quickhits.txt`, // .env, .git/, .htpasswd, wp-config.php, backups (2567 entries)
  // Spring Boot actuator endpoints (heapdump=memory dump, env=secrets, shutdown=RCE)
  'spring-actuator': `/home/clpz/.clpzcode/wordlists/spring-actuator.txt`, // local curated list: /actuator/*, /h2-console, Swagger
  // WordPress-specific paths (plugins, themes, admin)
  'wordpress': `${SECLISTS}/Discovery/Web-Content/CMS/wordpress.fuzz.txt`, // WP endpoints (plugins, xmlrpc, wp-json)
}

function resolveWordlist(w: string): string {
  return WORDLIST_MAP[w.toLowerCase()] ?? w
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('Target URL with FUZZ keyword (e.g. "http://target/FUZZ")'),
    wordlist: z
      .string()
      .default('common')
      .describe('Wordlist shortcut (common/big/medium/small/api/params/subdomains) or absolute path'),
    extensions: z
      .array(z.string())
      .optional()
      .describe('File extensions to append (e.g. [".php",".html"])'),
    method: z
      .enum(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'])
      .default('GET')
      .describe('HTTP method'),
    data: z.string().optional().describe('Request body for POST (use FUZZ keyword inside)'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe('Additional HTTP headers'),
    filter_status: z
      .array(z.number().int())
      .default([404])
      .describe('HTTP status codes to exclude from results'),
    match_status: z
      .array(z.number().int())
      .optional()
      .describe('Only include these HTTP status codes'),
    filter_size: z
      .array(z.number().int())
      .optional()
      .describe('Exclude responses of exactly these byte sizes'),
    threads: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(40)
      .describe('Concurrent threads (default: 40)'),
    timeout_secs: z
      .number()
      .int()
      .min(10)
      .max(3600)
      .default(300)
      .describe('Total scan timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const HitSchema = z.object({
  url: z.string(),
  status: z.number(),
  length: z.number(),
  words: z.number(),
  lines: z.number(),
  content_type: z.string().optional(),
  redirect_location: z.string().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    hits: z.array(HitSchema),
    total_hits: z.number(),
    duration_ms: z.number(),
    wordlist_used: z.string(),
    command: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function runFuzz(input: z.infer<InputSchema>, context: ToolUseContext): Promise<Output> {
  const wordlistPath = resolveWordlist(input.wordlist)
  const start = Date.now()

  // Validate wordlist file existence for known shortcuts
  if (WORDLIST_MAP[input.wordlist.toLowerCase()] && !existsSync(wordlistPath)) {
    const hint = wordlistPath.startsWith(SECLISTS)
      ? `SecLists file missing: ${wordlistPath} — reinstall with: sudo pacman -S seclists`
      : `Wordlist file missing: ${wordlistPath}`
    return {
      hits: [],
      total_hits: 0,
      duration_ms: 0,
      wordlist_used: wordlistPath,
      command: '',
      error: hint,
    }
  }
  const tmpDir = await mkdtemp(join(tmpdir(), 'fuzz-'))
  const outputFile = join(tmpDir, 'results.json')

  try {
    const args: string[] = [
      '-w', wordlistPath,
      '-u', input.url,
      '-of', 'json',
      '-o', outputFile,
      '-t', String(input.threads),
      '-X', input.method,
      '-timeout', String(Math.floor(input.timeout_secs / input.threads)),
      '-s', // silent (no progress bar)
    ]

    if (input.extensions && input.extensions.length > 0) {
      args.push('-e', input.extensions.join(','))
    }

    if (input.data) {
      args.push('-d', input.data)
    }

    if (input.headers) {
      for (const [k, v] of Object.entries(input.headers)) {
        const safeKey = k.replace(/[\r\n]/g, '')
        const safeVal = v.replace(/[\r\n]/g, '')
        args.push('-H', `${safeKey}: ${safeVal}`)
      }
    }

    if (input.filter_status.length > 0) {
      args.push('-fc', input.filter_status.join(','))
    }

    if (input.match_status && input.match_status.length > 0) {
      args.push('-mc', input.match_status.join(','))
    }

    if (input.filter_size && input.filter_size.length > 0) {
      args.push('-fs', input.filter_size.join(','))
    }

    const { code, stderr } = await runNativeWithTask({
      binary: '/usr/sbin/ffuf',
      args,
      description: `Fuzz: ${input.url}`,
      command: `ffuf ${args.join(' ')}`,
      timeoutMs: input.timeout_secs * 1000,
      setAppState: context.setAppStateForTasks ?? context.setAppState,
      agentId: context.agentId,
      abortSignal: context.abortController.signal,
    })
    if (code !== 0) {
      return {
        hits: [],
        total_hits: 0,
        duration_ms: Date.now() - start,
        wordlist_used: wordlistPath,
        command: `ffuf ${args.join(' ')}`,
        error: stderr || `ffuf exited with code ${code}`,
      }
    }

    let raw: string
    try {
      raw = await readFile(outputFile, 'utf8')
    } catch {
      return {
        hits: [],
        total_hits: 0,
        duration_ms: Date.now() - start,
        wordlist_used: wordlistPath,
        command: `ffuf ${args.join(' ')}`,
        error: 'No output file produced — ffuf may have found nothing or crashed',
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        hits: [],
        total_hits: 0,
        duration_ms: Date.now() - start,
        wordlist_used: wordlistPath,
        command: `ffuf ${args.join(' ')}`,
        error: 'Failed to parse ffuf JSON output',
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits: z.infer<typeof HitSchema>[] = (parsed.results ?? []).map((r: any) => ({
      url: r.url ?? '',
      status: r.status ?? 0,
      length: r.length ?? 0,
      words: r.words ?? 0,
      lines: r.lines ?? 0,
      content_type: r.content_type || undefined,
      redirect_location: r.redirectlocation || undefined,
    }))

    return {
      hits,
      total_hits: hits.length,
      duration_ms: Date.now() - start,
      wordlist_used: wordlistPath,
      command: `ffuf ${args.join(' ')}`,
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

export const FuzzTool = buildTool({
  name: FUZZ_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'web fuzzing — directory/file/parameter brute force with ffuf and SecLists',
  maxResultSizeChars: 40_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.url) return `Fuzz ${i.url}`
    return 'Web fuzzing with ffuf'
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
    if (!i?.url) return 'Fuzz'
    return `Fuzz:${i.url.replace(/^https?:\/\//, '').slice(0, 30)}`
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `ffuf ${input.url ?? ''} ${input.wordlist ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const url = input?.url ?? ''
    return url ? `Fuzzing ${url}` : 'Fuzz scan'
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i.url ? `${i.url} (${i.wordlist ?? 'common'})` : 'fuzz'
  },
  renderToolResultMessage,
  async call(input, context) {
    const result = await runFuzz(input, context)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error && content.hits.length === 0) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: `Fuzz error: ${content.error}` }
    }

    const lines: string[] = [
      `ffuf scan — ${content.total_hits} hits (${(content.duration_ms / 1000).toFixed(1)}s)`,
      `Command: ${content.command}`,
      `Wordlist: ${content.wordlist_used}`,
      '',
    ]

    for (const h of content.hits) {
      const redir = h.redirect_location ? ` → ${h.redirect_location}` : ''
      lines.push(`  [${h.status}] ${h.url}  (${h.length}b)${redir}`)
    }

    if (content.error) lines.push(`\nWarning: ${content.error}`)

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
