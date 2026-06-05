import { mkdir, readFile } from 'fs/promises'
import { dirname } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { getFileModificationTime, writeTextContent } from '../../utils/file.js'
import { readFileSyncWithMetadata, type LineEndingType } from '../../utils/fileRead.js'
import { isENOENT } from '../../utils/errors.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { checkWritePermissionForTool } from '../../utils/permissions/filesystem.js'
import { applyEditToFile, findActualString } from '../FileEditTool/utils.js'
import { FileEditTool } from '../FileEditTool/FileEditTool.js'
import {
  renderToolUseProgressMessage,
  renderToolUseMessage,
  renderToolResultMessage,
  getToolUseSummary,
} from './UI.js'

export const MULTI_EDIT_TOOL_NAME = 'MultiEdit'

type SingleEdit = {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export type EditResult =
  | { file_path: string; success: true }
  | { file_path: string; success: false; error: string }

export type MultiEditOutput = {
  results: EditResult[]
}

// Internal result also carries the final written content so call() can refresh
// readFileState after the write (the public EditResult shape stays unchanged).
type InternalEditResult =
  | { file_path: string; success: true; content: string }
  | { file_path: string; success: false; error: string }

const inputSchema = lazySchema(() =>
  z.strictObject({
    edits: z
      .array(
        z.object({
          file_path: z
            .string()
            .describe('Absolute path of the file to edit'),
          old_string: z
            .string()
            .describe(
              'Text to find (empty string creates new file with new_string as content)',
            ),
          new_string: z.string().describe('Replacement text'),
          replace_all: z
            .boolean()
            .optional()
            .describe('Replace all occurrences (default: false)'),
        }),
      )
      .min(1)
      .max(100)
      .describe(
        'List of edits to apply. Edits targeting the same file are applied sequentially in order; edits to different files are applied concurrently.',
      ),
  }))

const outputSchema = lazySchema(() =>
  z.object({
    results: z.array(
      z.union([
        z.object({ file_path: z.string(), success: z.literal(true) }),
        z.object({
          file_path: z.string(),
          success: z.literal(false),
          error: z.string(),
        }),
      ]),
    ),
  }))

async function applyEditsToFile(
  filePath: string,
  edits: Array<Omit<SingleEdit, 'file_path'>>,
  readFileState: ToolUseContext['readFileState'],
): Promise<InternalEditResult> {
  try {
    const expanded = expandPath(filePath)
    // Read with metadata so edits run against LF-normalized content (matching
    // the model's LF Read, so old_string matches on CRLF/UTF-16 files) and the
    // write preserves the file's original encoding + line endings. ENOENT means
    // a new file; any other read error is real and propagates.
    let content: string
    let encoding: BufferEncoding = 'utf8'
    let lineEndings: LineEndingType = 'LF'
    let fileExists = false
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- mirrors FileEditTool's metadata read
      const meta = readFileSyncWithMetadata(expanded)
      content = meta.content
      encoding = meta.encoding
      lineEndings = meta.lineEndings
      fileExists = true
    } catch (e) {
      if (!isENOENT(e)) throw e
      content = ''
    }

    // Staleness recheck right before writing — closes the TOCTOU window between
    // validateInput and this write. If the file changed on disk since the
    // recorded read and the content actually differs, abort THIS file rather
    // than clobber a concurrent external edit (mirrors FileEditTool; honors the
    // "atomic read-modify-write" contract this tool documents).
    if (fileExists) {
      const lastRead = readFileState.get(expanded)
      if (lastRead && getFileModificationTime(expanded) > lastRead.timestamp) {
        const isFullRead =
          (lastRead.offset === undefined || lastRead.offset === 1) &&
          lastRead.limit === undefined
        if (!(isFullRead && content === lastRead.content)) {
          return {
            file_path: filePath,
            success: false,
            error: `File ${filePath} was modified since it was read. Read it again before editing.`,
          }
        }
      }
    }

    for (const edit of edits) {
      if (edit.old_string === '') {
        content = edit.new_string
        continue
      }
      const actual = findActualString(content, edit.old_string) || edit.old_string
      if (!content.includes(actual)) {
        const preview = edit.old_string.length > 80
          ? `"${edit.old_string.slice(0, 80)}..."`
          : `"${edit.old_string}"`
        return {
          file_path: filePath,
          success: false,
          error: `String not found in file: ${preview}`,
        }
      }
      if (edit.old_string === edit.new_string) {
        continue
      }
      content = applyEditToFile(content, actual, edit.new_string, edit.replace_all ?? false)
    }

    await mkdir(dirname(expanded), { recursive: true })
    writeTextContent(expanded, content, encoding, lineEndings)
    return { file_path: filePath, success: true, content }
  } catch (err) {
    return {
      file_path: filePath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export const MultiEditTool = buildTool({
  name: MULTI_EDIT_TOOL_NAME,
  searchHint: 'edit multiple files at once in parallel',
  maxResultSizeChars: 50_000,
  strict: true,
  async description() {
    return 'Edit multiple files simultaneously in parallel'
  },
  async prompt() {
    return [
      `## ${MULTI_EDIT_TOOL_NAME} — Edit multiple files at once`,
      '',
      'Use this tool when you need to make changes across several files at the',
      'same time. Edits within the same file are applied sequentially in the',
      'order given; edits to different files run concurrently.',
      '',
      'Provide absolute paths. Each edit follows the same old_string/new_string',
      'semantics as the standard Edit tool. On error one file does not block',
      'the others — all results are returned.',
    ].join('\n')
  },
  userFacingName() {
    return 'MultiEdit'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const files = new Set(input?.edits?.map(e => e.file_path) ?? [])
    return `Editing ${files.size} file${files.size !== 1 ? 's' : ''}`
  },
  get inputSchema() {
    return inputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  getPath(input) {
    return input.edits[0]?.file_path ?? ''
  },
  isConcurrencySafe() {
    return false
  },
  // Read-before-Edit guard (mirrors FileEditTool): MultiEdit previously read each
  // file fresh from disk at write time with no readFileState check, so concurrent
  // external edits between the model's observation and the write were silently
  // clobbered. Require a fresh full read of every target file (except pure
  // creations) before editing, matching the atomic read-modify-write contract.
  async validateInput(input, toolUseContext: ToolUseContext) {
    const byFile = new Map<string, SingleEdit[]>()
    for (const e of input.edits) {
      if (!byFile.has(e.file_path)) byFile.set(e.file_path, [])
      byFile.get(e.file_path)!.push(e)
    }
    for (const [filePath, fileEdits] of byFile) {
      const fullFilePath = expandPath(filePath)
      // A batch whose first edit creates the file (old_string === '') needs no
      // prior read — matches FileEditTool's new-file allowance.
      const isCreate = fileEdits[0]?.old_string === ''
      const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
      if (!readTimestamp) {
        if (isCreate) {
          // Creation needs no prior read, but old_string='' makes applyEditsToFile
          // REPLACE the whole file — so if the path already exists with content on
          // disk and was never read, this would silently clobber it. Match
          // FileEditTool (errorCode 3): reject creation over an existing non-empty
          // file; require a read first. (Reads disk to catch a file created/grown
          // after readFileState was last populated.)
          let onDisk: string | null = null
          try {
            onDisk = await readFile(fullFilePath, 'utf8')
          } catch {
            onDisk = null
          }
          if (onDisk !== null && onDisk.trim() !== '') {
            return {
              result: false,
              behavior: 'ask' as const,
              message: `Cannot create ${filePath}: file already exists. Read it first before editing it.`,
              errorCode: 3,
            }
          }
          continue
        }
        return {
          result: false,
          behavior: 'ask' as const,
          message: `File ${filePath} has not been read yet. Read it first before editing it.`,
          errorCode: 6,
        }
      }
      if (readTimestamp.isPartialView) {
        return {
          result: false,
          behavior: 'ask' as const,
          message: `File ${filePath} was only partially read. Read the full file before editing it.`,
          errorCode: 6,
        }
      }
      const lastWriteTime = getFileModificationTime(fullFilePath)
      if (lastWriteTime > readTimestamp.timestamp) {
        // Tolerate same-content/different-mtime (linter, cloud sync) for full
        // reads, exactly like FileEditTool; otherwise reject as stale.
        const isFullRead =
          (readTimestamp.offset === undefined || readTimestamp.offset === 1) &&
          readTimestamp.limit === undefined
        let onDisk: string | null = null
        try {
          onDisk = (await readFile(fullFilePath, 'utf8')).replaceAll('\r\n', '\n')
        } catch {
          onDisk = null
        }
        if (!(isFullRead && onDisk !== null && onDisk === readTimestamp.content)) {
          return {
            result: false,
            behavior: 'ask' as const,
            message: `File ${filePath} has been modified since read, either by the user or by a linter. Read it again before editing it.`,
            errorCode: 7,
          }
        }
      }
    }
    return { result: true }
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    const uniquePaths = [...new Set(input.edits.map(e => e.file_path))]
    // Check each unique file — return most restrictive result
    for (const filePath of uniquePaths) {
      const result = checkWritePermissionForTool(
        FileEditTool,
        { file_path: expandPath(filePath), old_string: '', new_string: '' },
        appState.toolPermissionContext,
      )
      if (result.behavior === 'deny') {
        return result
      }
      if (result.behavior === 'ask') {
        return { ...result, updatedInput: input }
      }
    }
    return { behavior: 'allow', updatedInput: input }
  },
  async call({ edits }, { readFileState }: ToolUseContext) {
    // Group edits by file path, preserving insertion order
    const byFile = new Map<string, Array<Omit<SingleEdit, 'file_path'>>>()
    for (const { file_path, old_string, new_string, replace_all } of edits) {
      if (!byFile.has(file_path)) byFile.set(file_path, [])
      byFile.get(file_path)!.push({ old_string, new_string, replace_all })
    }

    const internal = await Promise.all(
      [...byFile.entries()].map(([filePath, fileEdits]) =>
        applyEditsToFile(filePath, fileEdits, readFileState),
      ),
    )

    // Refresh readFileState for each file we just wrote so a subsequent edit of
    // the same file in this session isn't wrongly rejected as "modified since
    // read" (mirrors FileEditTool/FileWriteTool, which the previous code omitted
    // — call() ignored the context arg entirely).
    for (const r of internal) {
      if (r.success) {
        const expanded = expandPath(r.file_path)
        readFileState.set(expanded, {
          content: r.content,
          timestamp: getFileModificationTime(expanded),
          offset: undefined,
          limit: undefined,
        })
      }
    }

    // Strip the internal `content` field so the public result shape is unchanged.
    const results: EditResult[] = internal.map(r =>
      r.success ? { file_path: r.file_path, success: true } : r,
    )
    return { data: { results } }
  },
  mapToolResultToToolResultBlockParam(data: MultiEditOutput, toolUseID) {
    const results = data?.results ?? []
    const ok = results.filter(r => r.success)
    const err = results.filter(r => !r.success)

    const lines: string[] = []
    for (const r of ok) lines.push(`✓ ${r.file_path}`)
    for (const r of err) {
      if (!r.success) lines.push(`✗ ${r.file_path}: ${r.error}`)
    }

    const summary =
      err.length === 0
        ? `Edited ${ok.length} file${ok.length !== 1 ? 's' : ''} successfully.`
        : `Edited ${ok.length} file${ok.length !== 1 ? 's' : ''}, ${err.length} failed.`

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${summary}\n\n${lines.join('\n')}`,
    }
  },
  renderToolUseProgressMessage,
  renderToolUseMessage,
  renderToolResultMessage,
} satisfies ToolDef<ReturnType<typeof inputSchema>, MultiEditOutput>)
