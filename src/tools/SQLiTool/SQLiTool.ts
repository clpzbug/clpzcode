import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runNativeWithTask } from '../../utils/task/nativeTaskRunner.js'
import { SQLI_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const ACTIONS = ['detect_only', 'dump_dbs', 'dump_tables', 'dump_data'] as const
const METHODS = ['GET', 'POST'] as const
const DBMS_TYPES = ['mysql', 'mssql', 'oracle', 'postgresql', 'sqlite', 'access'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('Target URL (e.g. "http://target/page.php?id=1")'),
    method: z.enum(METHODS).default('GET').describe('HTTP method'),
    data: z.string().optional().describe('POST body data'),
    cookie: z.string().optional().describe('Session cookie string'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional HTTP headers'),
    technique: z
      .string()
      .default('BEUSTQ')
      .describe('Injection techniques: B=boolean, E=error, U=union, S=stacked, T=time, Q=inline'),
    level: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(1)
      .describe('Detection level 1-5 (default: 1)'),
    risk: z
      .number()
      .int()
      .min(1)
      .max(3)
      .default(1)
      .describe('Risk level 1-3 (default: 1)'),
    dbms: z.enum(DBMS_TYPES).optional().describe('Target DBMS hint'),
    action: z.enum(ACTIONS).default('detect_only').describe('What to do after detection'),
    db: z.string().optional().describe('Target database name (for dump_tables/dump_data)'),
    table: z.string().optional().describe('Target table name (for dump_data)'),
    columns: z
      .array(z.string())
      .optional()
      .describe('Specific columns to dump (for dump_data)'),
    extra_args: z.string().optional().describe('Additional raw sqlmap arguments'),
    timeout_secs: z
      .number()
      .int()
      .min(30)
      .max(3600)
      .default(300)
      .describe('Timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    vulnerable: z.boolean(),
    url: z.string(),
    action: z.string(),
    databases: z.array(z.string()).optional(),
    tables: z.record(z.string(), z.array(z.string())).optional(),
    data: z.string().optional(),
    elapsed_secs: z.number(),
    output: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function buildArgs(input: z.infer<InputSchema>): string[] {
  const args: string[] = [
    '-u', input.url,
    '--batch',
    '--no-cast',
    '--technique', input.technique,
    '--level', String(input.level),
    '--risk', String(input.risk),
  ]

  if (input.method === 'POST') args.push('--method', 'POST')
  if (input.data) args.push('--data', input.data)
  if (input.cookie) args.push('--cookie', input.cookie)
  if (input.headers) {
    for (const [k, v] of Object.entries(input.headers)) {
      const safeKey = k.replace(/[\r\n]/g, '')
      const safeVal = v.replace(/[\r\n]/g, '')
      args.push('-H', `${safeKey}: ${safeVal}`)
    }
  }
  if (input.dbms) args.push('--dbms', input.dbms)

  switch (input.action) {
    case 'dump_dbs':
      args.push('--dbs')
      break
    case 'dump_tables':
      if (input.db) args.push('-D', input.db)
      args.push('--tables')
      break
    case 'dump_data':
      if (input.db) args.push('-D', input.db)
      if (input.table) args.push('-T', input.table)
      if (input.columns && input.columns.length > 0) args.push('-C', input.columns.join(','))
      args.push('--dump')
      break
  }

  if (input.extra_args) {
    args.push(...input.extra_args.split(/\s+/).filter(Boolean))
  }

  return args
}

function parseOutput(stdout: string): {
  vulnerable: boolean
  databases: string[]
  tables: Record<string, string[]>
  data: string
} {
  const vulnerable =
    stdout.includes('is vulnerable') ||
    stdout.includes('[CRITICAL]') ||
    stdout.includes('identified the following injection') ||
    stdout.includes('parameter ') && stdout.includes('appears to be') && stdout.includes('injectable')

  // Parse databases — sqlmap outputs: [*] dbname
  const databases: string[] = []
  for (const m of stdout.matchAll(/\[\*\]\s+(\S+)/g)) {
    const name = m[1]?.trim()
    if (name) databases.push(name)
  }

  // Parse tables — sqlmap outputs table names in +---+ bordered boxes
  const tables: Record<string, string[]> = {}
  let currentDb: string | undefined
  for (const line of stdout.split('\n')) {
    const dbMatch = line.match(/^Database:\s+(\S+)/)
    if (dbMatch?.[1]) { currentDb = dbMatch[1]; continue }
    if (currentDb) {
      const tableMatch = line.match(/^\|\s+(\S+)\s+\|$/)
      if (tableMatch?.[1]) {
        if (!tables[currentDb]) tables[currentDb] = []
        tables[currentDb].push(tableMatch[1])
      }
    }
  }

  // Capture dump data
  const dumpMatch = stdout.match(/\+[-+]+\+\n([\s\S]+?)\+[-+]+\+/)
  const data = dumpMatch ? dumpMatch[0] : ''

  return { vulnerable, databases, tables, data }
}

async function runSQLi(input: z.infer<InputSchema>, context: ToolUseContext): Promise<Output> {
  const start = Date.now()
  const args = buildArgs(input)

  const { stdout, stderr, code } = await runNativeWithTask({
    binary: '/usr/bin/sqlmap',
    args,
    description: `SQLmap ${input.action}: ${input.url}`,
    command: `sqlmap ${args.join(' ')}`,
    timeoutMs: input.timeout_secs * 1000,
    setAppState: context.setAppStateForTasks ?? context.setAppState,
    agentId: context.agentId,
    abortSignal: context.abortController.signal,
    env: { HOME: '/tmp' },
  })

  if (code !== 0 && !stdout) {
    return {
      vulnerable: false,
      url: input.url,
      action: input.action,
      elapsed_secs: (Date.now() - start) / 1000,
      output: stderr || `sqlmap exited with code ${code}`,
      error: stderr || `sqlmap exited with code ${code}`,
    }
  }

  const parsed = parseOutput(stdout)

  return {
    vulnerable: parsed.vulnerable,
    url: input.url,
    action: input.action,
    databases: parsed.databases.length > 0 ? parsed.databases : undefined,
    tables: Object.keys(parsed.tables).length > 0 ? parsed.tables : undefined,
    data: parsed.data || undefined,
    elapsed_secs: (Date.now() - start) / 1000,
    output: stdout.substring(0, 20_000),
  }
}

export const SQLiTool = buildTool({
  name: SQLI_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'sql injection — detect and exploit SQL injection vulnerabilities with sqlmap',
  maxResultSizeChars: 25_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.url) return `SQLi ${i.action ?? 'detect'}: ${i.url}`
    return 'SQL injection testing with sqlmap'
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
    return i?.action ? `SQLi:${i.action}` : 'SQLi'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `sqlmap ${input.url ?? ''} ${input.action ?? 'detect_only'}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const action = input?.action ?? 'detect'
    const url = input?.url ?? '?'
    return `SQLi ${action}: ${url}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.action ?? 'detect'}: ${i.url ?? '?'}`
  },
  renderToolResultMessage,
  async call(input, context) {
    const result = await runSQLi(input, context)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: `SQLi error: ${content.error}` }
    }

    const lines: string[] = [
      `sqlmap ${content.action} — ${content.elapsed_secs.toFixed(1)}s`,
      `URL: ${content.url}`,
      `Vulnerable: ${content.vulnerable ? 'YES' : 'NO'}`,
      '',
    ]

    if (content.databases && content.databases.length > 0) {
      lines.push('Databases:')
      for (const db of content.databases) lines.push(`  ${db}`)
      lines.push('')
    }

    if (content.tables) {
      for (const [db, tbls] of Object.entries(content.tables)) {
        lines.push(`Tables in ${db}:`)
        for (const t of tbls) lines.push(`  ${t}`)
        lines.push('')
      }
    }

    if (content.data) {
      lines.push('Data:')
      lines.push(content.data)
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
