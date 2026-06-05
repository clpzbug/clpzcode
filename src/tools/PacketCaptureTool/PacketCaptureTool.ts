import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runNativeWithTask } from '../../utils/task/nativeTaskRunner.js'
import { PACKET_CAPTURE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    interface: z
      .string()
      .optional()
      .describe('Network interface (e.g. "eth0", "lo", "any")'),
    pcap_file: z
      .string()
      .optional()
      .describe('Path to existing .pcap/.pcapng file for offline analysis'),
    capture_filter: z
      .string()
      .optional()
      .describe('BPF capture filter (e.g. "tcp port 80", "host 10.0.0.1")'),
    display_filter: z
      .string()
      .optional()
      .describe('Wireshark display filter (e.g. "http", "dns", "tcp.flags.syn==1")'),
    count: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .default(100)
      .describe('Max packets to capture/process (default: 100)'),
    duration_secs: z
      .number()
      .int()
      .min(1)
      .max(60)
      .default(10)
      .describe('Max capture duration in seconds (default: 10, max: 60)'),
    fields: z
      .array(z.string())
      .optional()
      .describe('Specific fields to extract (e.g. ["ip.src","ip.dst","tcp.dstport"])'),
    summary_only: z
      .boolean()
      .default(false)
      .describe('Return protocol statistics instead of packet list'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const PacketSchema = z.object({
  number: z.number(),
  time: z.string(),
  source: z.string(),
  destination: z.string(),
  protocol: z.string(),
  length: z.number(),
  info: z.string(),
})

const outputSchema = lazySchema(() =>
  z.object({
    packets: z.array(PacketSchema),
    total_packets: z.number(),
    elapsed_secs: z.number(),
    command: z.string(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function buildArgs(input: z.infer<InputSchema>): string[] {
  const args: string[] = []

  if (input.pcap_file) {
    args.push('-r', input.pcap_file)
  } else {
    const iface = input.interface ?? 'any'
    args.push('-i', iface, '-c', String(input.count), '-a', `duration:${input.duration_secs}`)
  }

  if (input.capture_filter && !input.pcap_file) {
    args.push('-f', input.capture_filter)
  }

  if (input.display_filter) {
    args.push('-Y', input.display_filter)
  }

  if (input.summary_only) {
    args.push('-q', '-z', 'io,phs')
    return args
  }

  if (input.fields && input.fields.length > 0) {
    args.push('-T', 'fields', '-E', 'separator=|', '-E', 'header=y')
    for (const f of input.fields) args.push('-e', f)
  } else {
    // Default: one-line summary per packet
    args.push('-T', 'fields', '-E', 'separator=|')
    args.push(
      '-e', 'frame.number',
      '-e', 'frame.time_relative',
      '-e', 'ip.src',
      '-e', 'ip.dst',
      '-e', 'frame.protocols',
      '-e', 'frame.len',
      '-e', '_ws.col.Info',
    )
  }

  return args
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePackets(stdout: string): z.infer<typeof PacketSchema>[] {
  const packets: z.infer<typeof PacketSchema>[] = []
  const lines = stdout.split('\n').filter(Boolean)

  for (const line of lines) {
    const parts = line.split('|')
    if (parts.length >= 4) {
      packets.push({
        number: parseInt(parts[0] ?? '0') || 0,
        time: parts[1] ?? '',
        source: parts[2] ?? '',
        destination: parts[3] ?? '',
        protocol: parts[4] ?? '',
        length: parseInt(parts[5] ?? '0') || 0,
        info: parts[6] ?? '',
      })
    }
  }

  return packets
}

async function runCapture(input: z.infer<InputSchema>, context: ToolUseContext): Promise<Output> {
  const start = Date.now()
  const args = buildArgs(input)
  const command = `tshark ${args.join(' ')}`

  const { stdout, stderr, code } = await runNativeWithTask({
    binary: '/usr/bin/tshark',
    args,
    description: input.pcap_file ? `tshark: ${input.pcap_file}` : `Capture: ${input.interface ?? 'any'}`,
    command,
    timeoutMs: (input.duration_secs + 5) * 1000,
    setAppState: context.setAppStateForTasks ?? context.setAppState,
    agentId: context.agentId,
    abortSignal: context.abortController.signal,
  })

  if (code !== 0 && !stdout) {
    return {
      packets: [],
      total_packets: 0,
      elapsed_secs: (Date.now() - start) / 1000,
      command,
      error: stderr || `tshark exited with code ${code}`,
    }
  }

  if (input.summary_only) {
    return {
      packets: [],
      total_packets: 0,
      elapsed_secs: (Date.now() - start) / 1000,
      command,
      summary: stdout.trim(),
    }
  }

  const packets = parsePackets(stdout)

  return {
    packets: packets.slice(0, input.count),
    total_packets: packets.length,
    elapsed_secs: (Date.now() - start) / 1000,
    command,
    summary: stderr ? `tshark stderr: ${stderr.substring(0, 200)}` : undefined,
  }
}

export const PacketCaptureTool = buildTool({
  name: PACKET_CAPTURE_TOOL_NAME,
  searchHint: 'packet capture — capture and analyze network traffic with tshark (Wireshark CLI)',
  maxResultSizeChars: 200_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.pcap_file) return `Analyze ${i.pcap_file}`
    if (i.interface) return `Capture on ${i.interface}`
    return 'Network packet capture'
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
    const src = i?.pcap_file ? 'pcap' : (i?.interface ?? 'live')
    return `PacketCapture:${src}`
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `tshark ${input.interface ?? input.pcap_file ?? ''} ${input.display_filter ?? ''}`
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
    return i?.pcap_file ? `Analyze: ${i.pcap_file}` : `Capture: ${i?.interface ?? 'any'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i.pcap_file ? `analyze: ${i.pcap_file}` : `capture: ${i.interface ?? 'any'}`
  },
  renderToolResultMessage,
  async call(input, context) {
    const result = await runCapture(input, context)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: `PacketCapture error: ${content.error}` }
    }

    if (content.summary && content.total_packets === 0) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: content.summary }
    }

    const lines: string[] = [
      `tshark — ${content.total_packets} packets (${content.elapsed_secs.toFixed(1)}s)`,
      '',
    ]

    for (const p of content.packets) {
      lines.push(`  #${p.number} ${p.time}s  ${p.source} → ${p.destination}  [${p.protocol}]  ${p.length}b  ${p.info}`)
    }

    if (content.summary) lines.push(`\n${content.summary}`)

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
