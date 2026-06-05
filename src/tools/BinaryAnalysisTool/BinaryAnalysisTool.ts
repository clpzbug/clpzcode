import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { BINARY_ANALYSIS_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const OPERATIONS = ['file_info', 'strings', 'hexdump', 'disassemble', 'hex', 'symbols'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    path: z.string().describe('Absolute path to the binary file'),
    operation: z.enum(OPERATIONS).describe('file_info | strings | hexdump | disassemble | hex'),
    offset: z.number().int().min(0).optional().describe('Byte offset to start at'),
    length: z.number().int().min(1).max(65536).optional().describe('Number of bytes to read'),
    min_string_len: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(4)
      .describe('Minimum string length for strings operation'),
    section: z
      .string()
      .optional()
      .describe('ELF section name for disassemble (default: .text)'),
    extra_args: z.string().optional().describe('Additional raw arguments'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    operation: z.string(),
    path: z.string(),
    result: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function runCmd(
  bin: string,
  args: string[],
  timeout = 30_000,
  signal?: AbortSignal,
): Promise<string> {
  const { stdout, stderr } = await execFileAsync(bin, args, {
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    signal,
  })
  return (stdout + (stderr ? `\nSTDERR: ${stderr}` : '')).trim()
}

async function fileInfo(path: string, signal?: AbortSignal): Promise<string> {
  const parts: string[] = []

  // file command
  try {
    const out = await runCmd('/usr/bin/file', ['-b', path], 30_000, signal)
    parts.push(`[file] ${out}`)
  } catch (e) {
    parts.push(`[file] error: ${e}`)
  }

  // size
  try {
    const out = await runCmd('/usr/bin/stat', ['-c', '%s bytes', path], 30_000, signal)
    parts.push(`[size] ${out}`)
  } catch {}

  // ELF check
  try {
    const out = await runCmd('/usr/bin/readelf', ['-h', path], 30_000, signal)
    parts.push(`[readelf -h]\n${out}`)
  } catch {}

  // shared libs
  try {
    const out = await runCmd('/usr/bin/ldd', [path], 30_000, signal)
    parts.push(`[ldd]\n${out}`)
  } catch {}

  // Security protections (checksec-style via readelf)
  try {
    const dynSyms = await runCmd('/usr/bin/readelf', ['-s', '--wide', path], 30_000, signal).catch(() => '')
    const programHeaders = await runCmd('/usr/bin/readelf', ['-l', '--wide', path], 30_000, signal).catch(() => '')
    const sectionHeaders = await runCmd('/usr/bin/readelf', ['-S', '--wide', path], 30_000, signal).catch(() => '')
    const elfHeader = await runCmd('/usr/bin/readelf', ['-h', '--wide', path], 30_000, signal).catch(() => '')

    const nx = !programHeaders.includes('GNU_STACK') || !/ E /.test(programHeaders) ? 'NX: enabled' : 'NX: DISABLED (executable stack!)'
    const pie = /Type:\s*DYN/.test(elfHeader) ? 'PIE: enabled' : 'PIE: DISABLED (fixed base address)'
    const canary = dynSyms.includes('__stack_chk_fail') ? 'Stack Canary: yes' : 'Stack Canary: NO'
    const relro = programHeaders.includes('GNU_RELRO')
      ? (sectionHeaders.includes('.got.plt') ? 'RELRO: partial' : 'RELRO: full')
      : 'RELRO: NONE'
    const fortify = dynSyms.includes('__printf_chk') || dynSyms.includes('__memcpy_chk') ? 'FORTIFY: yes' : 'FORTIFY: no'

    parts.push(`[security]\n${nx}\n${pie}\n${canary}\n${relro}\n${fortify}`)
  } catch {}

  return parts.join('\n\n')
}

async function runStrings(path: string, minLen: number, extraArgs?: string, signal?: AbortSignal): Promise<string> {
  const args = ['-n', String(minLen)]
  if (extraArgs) args.push(...extraArgs.split(/\s+/).filter(Boolean))
  args.push(path)
  return runCmd('/usr/bin/strings', args, 60_000, signal)
}

async function runHexdump(path: string, offset?: number, length?: number, signal?: AbortSignal): Promise<string> {
  const args: string[] = ['-C']
  if (offset) args.push('-s', String(offset))
  if (length) args.push('-n', String(length))
  args.push(path)
  return runCmd('/usr/bin/hexdump', args, 30_000, signal)
}

async function runXxd(path: string, offset?: number, length?: number, signal?: AbortSignal): Promise<string> {
  const args: string[] = []
  if (offset) args.push('-s', String(offset))
  if (length) args.push('-l', String(length))
  args.push(path)
  return runCmd('/usr/bin/xxd', args, 30_000, signal)
}

async function disassemble(path: string, section?: string, extraArgs?: string, signal?: AbortSignal): Promise<string> {
  const sect = section ?? '.text'
  const args = ['-d', '-j', sect, '--no-show-raw-insn']
  if (extraArgs) args.push(...extraArgs.split(/\s+/).filter(Boolean))
  args.push(path)
  return runCmd('/usr/bin/objdump', args, 60_000, signal)
}

async function runSymbols(path: string, signal?: AbortSignal): Promise<string> {
  const parts: string[] = []
  // Dynamic symbols (imported/exported functions — most useful for analysis)
  try {
    const dyn = await runCmd('/usr/bin/readelf', ['--dyn-syms', '--wide', path], 30_000, signal)
    parts.push('[dynamic symbols]\n' + dyn)
  } catch {}
  // Static symbols (functions in non-stripped binaries — useful for CTF)
  try {
    const stat = await runCmd('/usr/bin/nm', ['-n', '--demangle', path], 30_000, signal)
    parts.push('[nm symbols]\n' + stat)
  } catch {
    parts.push('[nm symbols] (stripped or nm failed)')
  }
  // Import/export table via objdump
  try {
    const od = await runCmd('/usr/bin/objdump', ['-T', path], 30_000, signal)
    parts.push('[objdump -T dynamic relocs]\n' + od)
  } catch {}
  return parts.join('\n\n')
}

async function runBinaryAnalysis(input: z.infer<InputSchema>, signal?: AbortSignal): Promise<Output> {
  try {
    let result: string

    switch (input.operation) {
      case 'file_info':
        result = await fileInfo(input.path, signal)
        break
      case 'strings':
        result = await runStrings(input.path, input.min_string_len, input.extra_args, signal)
        break
      case 'hexdump':
        result = await runHexdump(input.path, input.offset, input.length ?? 512, signal)
        break
      case 'hex':
        result = await runXxd(input.path, input.offset, input.length ?? 256, signal)
        break
      case 'disassemble':
        result = await disassemble(input.path, input.section, input.extra_args, signal)
        break
      case 'symbols':
        result = await runSymbols(input.path, signal)
        break
    }

    return { operation: input.operation, path: input.path, result }
  } catch (err) {
    return {
      operation: input.operation,
      path: input.path,
      result: '',
      error: String(err),
    }
  }
}

export const BinaryAnalysisTool = buildTool({
  name: BINARY_ANALYSIS_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'binary analysis — file info, symbols (readelf/nm/objdump), strings, hexdump, disassembly, security protections (NX/PIE/canary/RELRO) for CTF and binary exploitation',
  maxResultSizeChars: 200_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.path && i.operation) return `${i.operation} on ${i.path}`
    return 'Binary analysis'
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
    return i?.operation ? `BinaryAnalysis:${i.operation}` : 'BinaryAnalysis'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `binary ${input.operation ?? 'file_info'} ${input.path ?? ''}`
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
    return `Binary ${i?.operation ?? 'analyze'}: ${i?.path ?? '?'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.operation ?? '?'}: ${i.path ?? '?'}`
  },
  renderToolResultMessage,
  async call(input, context) {
    const result = await runBinaryAnalysis(input, context.abortController.signal)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `BinaryAnalysis error (${content.operation} on ${content.path}): ${content.error}`,
      }
    }
    const header = `[${content.operation}] ${content.path}\n\n`
    return { tool_use_id: toolUseID, type: 'tool_result', content: header + content.result }
  },
} satisfies ToolDef<InputSchema, Output>)
