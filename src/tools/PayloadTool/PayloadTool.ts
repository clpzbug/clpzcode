import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { PAYLOAD_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const PATT_BASE = '/usr/share/payloadsallthethings'

const inputSchema = lazySchema(() =>
  z.strictObject({
    operation: z
      .enum(['list', 'get', 'search'])
      .default('list')
      .describe('list=show categories, get=retrieve category content, search=search all'),
    category: z
      .string()
      .optional()
      .describe('Category name (for get operation). Partial matches accepted.'),
    query: z
      .string()
      .optional()
      .describe('Search query (for search operation)'),
    max_lines: z
      .number()
      .int()
      .min(10)
      .max(2000)
      .default(500)
      .describe('Max lines to return per file (default: 500)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    operation: z.string(),
    categories: z.array(z.string()).optional(),
    content: z.string().optional(),
    category_matched: z.string().optional(),
    search_results: z
      .array(z.object({ category: z.string(), line: z.string(), file: z.string() }))
      .optional(),
    total_results: z.number().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function listCategories(): Promise<string[]> {
  try {
    const entries = await readdir(PATT_BASE, { withFileTypes: true })
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort()
  } catch {
    return []
  }
}

async function getCategory(category: string, maxLines: number): Promise<{ content: string; matched: string } | null> {
  const categories = await listCategories()
  const lower = category.toLowerCase()
  const matched = categories.find(c => c.toLowerCase() === lower)
    ?? categories.find(c => c.toLowerCase().includes(lower))

  if (!matched) return null

  const dir = join(PATT_BASE, matched)
  const files = await readdir(dir)
  const mdFiles = files.filter(f => f.endsWith('.md') || f.endsWith('.txt')).sort()

  if (mdFiles.length === 0) {
    // Try reading all files
    const allFiles = files.filter(f => !f.startsWith('.')).slice(0, 3)
    if (allFiles.length === 0) return { content: '(empty directory)', matched }
    const parts = await Promise.all(
      allFiles.map(async f => {
        const content = await readFile(join(dir, f), 'utf8').catch(() => '')
        const lines = content.split('\n').slice(0, maxLines)
        return `### ${f}\n${lines.join('\n')}`
      }),
    )
    return { content: parts.join('\n\n'), matched }
  }

  const parts = await Promise.all(
    mdFiles.slice(0, 2).map(async f => {
      const content = await readFile(join(dir, f), 'utf8').catch(() => '')
      const lines = content.split('\n').slice(0, maxLines)
      return `### ${f}\n${lines.join('\n')}`
    }),
  )

  return { content: parts.join('\n\n'), matched }
}

async function searchPayloads(
  query: string,
  maxResults: number,
): Promise<Array<{ category: string; line: string; file: string }>> {
  const categories = await listCategories()
  const lower = query.toLowerCase()
  const results: Array<{ category: string; line: string; file: string }> = []

  for (const cat of categories) {
    if (results.length >= maxResults) break
    const dir = join(PATT_BASE, cat)
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      continue
    }
    const textFiles = files.filter(f => f.endsWith('.md') || f.endsWith('.txt'))

    for (const file of textFiles) {
      if (results.length >= maxResults) break
      try {
        const content = await readFile(join(dir, file), 'utf8')
        for (const line of content.split('\n')) {
          if (line.toLowerCase().includes(lower)) {
            results.push({ category: cat, file, line: line.trim() })
            if (results.length >= maxResults) break
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  return results
}

async function runPayload(input: z.infer<InputSchema>): Promise<Output> {
  if (input.operation === 'list') {
    const categories = await listCategories()
    if (categories.length === 0) {
      return { operation: 'list', error: `PayloadsAllTheThings not found at ${PATT_BASE}` }
    }
    return { operation: 'list', categories, total_results: categories.length }
  }

  if (input.operation === 'get') {
    if (!input.category) {
      return { operation: 'get', error: 'category is required for get operation' }
    }
    const result = await getCategory(input.category, input.max_lines)
    if (!result) {
      return { operation: 'get', error: `Category not found: ${input.category}` }
    }
    return { operation: 'get', content: result.content, category_matched: result.matched }
  }

  // search
  if (!input.query) {
    return { operation: 'search', error: 'query is required for search operation' }
  }
  const results = await searchPayloads(input.query, 100)
  return {
    operation: 'search',
    search_results: results,
    total_results: results.length,
  }
}

export const PayloadTool = buildTool({
  name: PAYLOAD_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'payloads — browse PayloadsAllTheThings for XSS, SQLi, SSRF, SSTI, and other attack payloads',
  maxResultSizeChars: 200_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.operation === 'get' && i.category) return `Payloads for ${i.category}`
    if (i.operation === 'search' && i.query) return `Search payloads: ${i.query}`
    return 'Browse PayloadsAllTheThings'
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
    const suffix = i?.category ? `:${i.category.slice(0, 20)}` : ''
    return i?.operation ? `Payload:${i.operation}${suffix}` : 'Payload'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `payload ${input.operation ?? 'list'} ${input.category ?? ''} ${input.query ?? ''}`
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
    const op = i?.operation ?? 'list'
    const ctx = i?.category ?? i?.query ?? ''
    return ctx ? `Payload ${op}: ${ctx}` : `Payload ${op}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.operation === 'get') return i.category ?? 'get'
    if (i.operation === 'search') return `search: ${i.query ?? ''}`
    return 'list categories'
  },
  renderToolResultMessage,
  async call(input) {
    const result = await runPayload(input)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: `Payload error: ${content.error}` }
    }

    if (content.operation === 'list' && content.categories) {
      const lines = [
        `PayloadsAllTheThings — ${content.categories.length} categories:`,
        '',
        ...content.categories.map(c => `  ${c}`),
      ]
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    if (content.operation === 'get' && content.content) {
      const header = `[${content.category_matched}]\n\n`
      return { tool_use_id: toolUseID, type: 'tool_result', content: header + content.content }
    }

    if (content.operation === 'search' && content.search_results) {
      const lines = [`Search results (${content.total_results} matches):`, '']
      for (const r of content.search_results) {
        lines.push(`[${r.category}/${r.file}] ${r.line}`)
      }
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(content) }
  },
} satisfies ToolDef<InputSchema, Output>)
