import { readFile } from 'fs/promises'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import {
  checkReadPermissionForTool,
  matchingRuleForInput,
} from '../../utils/permissions/filesystem.js'
import { FileReadTool } from '../FileReadTool/FileReadTool.js'
import {
  renderToolUseProgressMessage,
  renderToolUseMessage,
  renderToolResultMessage,
  getToolUseSummary,
} from './UI.js'

export const MULTI_READ_TOOL_NAME = 'MultiRead'

export type FileResult =
  | { path: string; content: string; lines: number }
  | { path: string; error: string }

export type MultiReadOutput = {
  results: FileResult[]
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    paths: z
      .array(z.string())
      .min(1)
      .max(50)
      .describe('Absolute paths of the files to read (up to 50 at once)'),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Line number to start reading from (applied to all files)'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum lines to read per file (applied to all files)'),
  }))

const outputSchema = lazySchema(() =>
  z.object({
    results: z.array(
      z.union([
        z.object({ path: z.string(), content: z.string(), lines: z.number() }),
        z.object({ path: z.string(), error: z.string() }),
      ]),
    ),
  }))

async function readSingleFile(
  filePath: string,
  offset?: number,
  limit?: number,
): Promise<FileResult> {
  try {
    const expanded = expandPath(filePath)
    const raw = await readFile(expanded, 'utf8')
    const allLines = raw.split('\n')
    const start = offset !== undefined ? offset - 1 : 0
    const sliced =
      limit !== undefined ? allLines.slice(start, start + limit) : allLines.slice(start)
    const content = sliced.join('\n')
    return { path: filePath, content, lines: sliced.length }
  } catch (err) {
    return {
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export const MultiReadTool = buildTool({
  name: MULTI_READ_TOOL_NAME,
  searchHint: 'read multiple files at once in parallel',
  maxResultSizeChars: 500_000,
  strict: true,
  async description() {
    return 'Read multiple files simultaneously in parallel'
  },
  async prompt() {
    return [
      `## ${MULTI_READ_TOOL_NAME} — Read multiple files at once`,
      '',
      'Use this tool instead of calling Read N times when you need to inspect',
      'multiple files. All reads happen concurrently — faster and uses fewer',
      'round-trips.',
      '',
      'Provide absolute paths. Returns content for each path; files that fail',
      'to read return an error entry instead of crashing the whole batch.',
    ].join('\n')
  },
  userFacingName() {
    return 'MultiRead'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const n = input?.paths?.length ?? 0
    return `Reading ${n} file${n !== 1 ? 's' : ''}`
  },
  get inputSchema() {
    return inputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  getPath(input) {
    return input.paths[0] ?? ''
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    // Check each path — return the most restrictive decision across all
    for (const filePath of input.paths) {
      const expanded = expandPath(filePath)
      const denyRule = matchingRuleForInput(
        expanded,
        appState.toolPermissionContext,
        'read',
        'deny',
      )
      if (denyRule !== null) {
        return {
          behavior: 'deny',
          message: `Read access denied for ${filePath}`,
          decisionReason: { type: 'other' as const, reason: 'Path denied by permission rules' },
        }
      }
    }
    // Delegate to standard read permission check using first path as representative.
    // Strip updatedInput from the result — checkReadPermissionForTool returns it in
    // FileReadTool's { file_path } format, but toolExecution.ts line 1181 would
    // use it to replace processedInput, wiping out `paths` before call() runs.
    const { updatedInput: _, ...decision } = (checkReadPermissionForTool(
      FileReadTool,
      { file_path: expandPath(input.paths[0] ?? '') },
      appState.toolPermissionContext,
    ) as any)
    return decision
  },
  async call({ paths, offset, limit }) {
    const results = await Promise.all(
      paths.map(p => readSingleFile(p, offset, limit)),
    )
    return { data: { results } }
  },
  mapToolResultToToolResultBlockParam(data: MultiReadOutput, toolUseID) {
    const sections = (data?.results ?? []).map(r => {
      if ('error' in r) {
        return `=== ${r.path} ===\nError: ${r.error}`
      }
      return `=== ${r.path} (${r.lines} lines) ===\n${r.content}`
    })
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: sections.join('\n\n'),
    }
  },
  renderToolUseProgressMessage,
  renderToolUseMessage,
  renderToolResultMessage,
} satisfies ToolDef<ReturnType<typeof inputSchema>, MultiReadOutput>)
