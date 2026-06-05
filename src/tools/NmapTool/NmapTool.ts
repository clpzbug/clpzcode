import { parseStringPromise } from 'xml2js'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runNativeWithTask } from '../../utils/task/nativeTaskRunner.js'
import { NMAP_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const SCAN_TYPES = [
  'quick',
  'service',
  'full',
  'vuln',
  'scripts',
  'custom',
  'aggressive',
  'udp',
  'stealth',
  'ping_sweep',
  'os_detect',
  'script_cat',
] as const

const NSE_CATEGORIES = [
  'auth', 'brute', 'default', 'discovery', 'dos', 'exploit',
  'external', 'fuzzer', 'intrusive', 'malware', 'safe', 'version', 'vuln',
] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    targets: z
      .array(z.string())
      .min(1)
      .describe('Hosts, IPs, or CIDR ranges to scan (e.g. ["192.168.1.1","10.0.0.0/24"])'),
    ports: z
      .string()
      .optional()
      .describe('Port specification: "80,443", "1-1024", "T:22,U:53". Omit for top 1000.'),
    scan_type: z
      .enum(SCAN_TYPES)
      .default('quick')
      .describe(
        'Scan preset: quick|service|full|vuln|scripts|custom|aggressive|udp|stealth|ping_sweep|os_detect|script_cat',
      ),
    scripts: z
      .array(z.string())
      .optional()
      .describe('NSE script names for scan_type=scripts (e.g. ["http-title","ssl-cert"])'),
    script_categories: z
      .array(z.enum(NSE_CATEGORIES))
      .optional()
      .describe(
        'NSE script categories for scan_type=script_cat or as additive filter (e.g. ["auth","brute","exploit","vuln"])',
      ),
    script_args: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Arguments passed to NSE scripts via --script-args (e.g. {"http.useragent":"Mozilla","smb.domain":"CORP"})',
      ),
    timing: z
      .number()
      .int()
      .min(0)
      .max(5)
      .default(4)
      .describe('Timing template 0-5 (default: 4). Use 3 for stealth, 2 for paranoid.'),
    no_ping: z
      .boolean()
      .optional()
      .describe('-Pn: skip host discovery — treat all hosts as online. Use for firewalled hosts.'),
    os_detect: z
      .boolean()
      .optional()
      .describe('-O --osscan-guess: enable OS fingerprinting (additive, works with any scan_type)'),
    traceroute: z
      .boolean()
      .optional()
      .describe('--traceroute: trace hop path to each host'),
    min_rate: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('--min-rate N: send packets no slower than N per second'),
    max_retries: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('--max-retries N: cap number of port scan probe retransmissions'),
    extra_args: z
      .string()
      .optional()
      .describe('Additional raw nmap arguments for scan_type=custom'),
    timeout_secs: z
      .number()
      .int()
      .min(10)
      .max(3600)
      .default(300)
      .describe('Scan timeout in seconds (default: 300)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const ScriptResultSchema = z.object({
  name: z.string(),
  output: z.string(),
})

const PortSchema = z.object({
  port: z.number(),
  protocol: z.string(),
  state: z.string(),
  service: z.string(),
  version: z.string().optional(),
  cpe: z.string().optional(),
  reason: z.string().optional(),
  scripts: z.array(ScriptResultSchema),
})

const TraceHopSchema = z.object({
  hop: z.number(),
  ip: z.string(),
  rtt: z.string().optional(),
})

const HostSchema = z.object({
  ip: z.string(),
  hostname: z.string().optional(),
  mac_address: z.string().optional(),
  status: z.string(),
  ports: z.array(PortSchema),
  os_guess: z.string().optional(),
  os_confidence: z.number().optional(),
  traceroute: z.array(TraceHopSchema).optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    hosts: z.array(HostSchema),
    total_hosts: z.number(),
    up_hosts: z.number(),
    scan_args: z.string(),
    elapsed_secs: z.number(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function buildArgs(input: z.infer<InputSchema>): string[] {
  const args: string[] = ['-oX', '-', '--host-timeout', `${input.timeout_secs}s`]

  args.push(`-T${input.timing ?? 4}`)

  switch (input.scan_type) {
    case 'quick':
      args.push('-sV', '--version-light')
      break
    case 'service':
      args.push('-sV', '-sC')
      break
    case 'full':
      args.push('-p-', '-sV')
      break
    case 'vuln':
      args.push('-sV', '--script', 'vuln')
      break
    case 'scripts':
      if (input.scripts && input.scripts.length > 0) {
        args.push('-sV', '--script', input.scripts.join(','))
      } else {
        args.push('-sV', '-sC')
      }
      break
    case 'aggressive':
      args.push('-A')
      break
    case 'udp':
      args.push('-sU', '--top-ports', '200')
      break
    case 'stealth':
      args.push('-sS', '-T2')
      break
    case 'ping_sweep':
      args.push('-sn')
      break
    case 'os_detect':
      args.push('-O', '--osscan-guess', '--version-light')
      break
    case 'script_cat': {
      const cats = input.script_categories ?? ['default']
      args.push('-sV', '--script', cats.join(','))
      break
    }
    case 'custom':
      if (input.extra_args) {
        args.push(...input.extra_args.split(/\s+/).filter(Boolean))
      }
      break
  }

  // Additive flags — work with any scan_type
  if (input.no_ping) args.push('-Pn')
  if (input.os_detect && input.scan_type !== 'os_detect') args.push('-O', '--osscan-guess')
  if (input.traceroute) args.push('--traceroute')
  if (input.min_rate) args.push('--min-rate', String(input.min_rate))
  if (input.max_retries !== undefined) args.push('--max-retries', String(input.max_retries))

  // script_categories as additive (when not already set via scan_type)
  if (
    input.script_categories?.length &&
    input.scan_type !== 'script_cat' &&
    input.scan_type !== 'vuln' &&
    input.scan_type !== 'scripts'
  ) {
    args.push('--script', input.script_categories.join(','))
  }

  // script_args — sanitize keys/values to prevent arg injection
  if (input.script_args && Object.keys(input.script_args).length > 0) {
    const safeArgs = Object.entries(input.script_args)
      .map(([k, v]) => `${k.replace(/[,=\s]/g, '')}=${v.replace(/,/g, '')}`)
      .join(',')
    args.push('--script-args', safeArgs)
  }

  if (input.ports) {
    args.push('-p', input.ports)
  }

  args.push(...input.targets)
  return args
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseScript(s: any): { name: string; output: string } {
  return {
    name: String(s.$.id ?? ''),
    output: String(s.$.output ?? ''),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePort(p: any): z.infer<typeof PortSchema> {
  const state = p.state?.[0]?.$.state ?? 'unknown'
  const reason = p.state?.[0]?.$.reason as string | undefined
  const service = p.service?.[0] ?? { $: {} }
  const scripts = (p.script ?? []).map(parseScript)

  // CPE from <cpe> child elements inside <service>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cpeList: string[] = (service.cpe ?? []).map((c: any) =>
    typeof c === 'string' ? c : String(c._ ?? c),
  )

  return {
    port: parseInt(p.$.portid, 10),
    protocol: p.$.protocol ?? 'tcp',
    state,
    service: service.$.name ?? 'unknown',
    version:
      [service.$.product, service.$.version, service.$.extrainfo].filter(Boolean).join(' ') ||
      undefined,
    cpe: cpeList[0],
    reason,
    scripts,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseHost(h: any): z.infer<typeof HostSchema> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addrs: string[] = (h.address ?? [])
    .filter((a: any) => a.$.addrtype === 'ipv4' || a.$.addrtype === 'ipv6')
    .map((a: any) => a.$.addr)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const macEntry = (h.address ?? []).find((a: any) => a.$.addrtype === 'mac')
  const macAddress = macEntry?.$.addr as string | undefined

  const hostnames: string[] = (h.hostnames?.[0]?.hostname ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n: any) => n.$.name,
  )

  const ports: z.infer<typeof PortSchema>[] = (h.ports?.[0]?.port ?? [])
    .map(parsePort)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) => p.state === 'open' || p.state === 'open|filtered')

  const status = h.status?.[0]?.$.state ?? 'unknown'

  // OS detection — pick highest accuracy match
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const osMatches: any[] = h.os?.[0]?.osmatch ?? []
  const bestOs = osMatches.sort(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a: any, b: any) => parseInt(b.$.accuracy ?? '0') - parseInt(a.$.accuracy ?? '0'),
  )[0]
  const osGuess = bestOs?.$.name as string | undefined
  const osConfidence = bestOs ? parseInt(bestOs.$.accuracy ?? '0') : undefined

  // Traceroute hops
  const traceHops: z.infer<typeof TraceHopSchema>[] | undefined = h.trace?.[0]?.hop?.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (hop: any) => ({
      hop: parseInt(hop.$.ttl ?? '0'),
      ip: String(hop.$.ipaddr ?? ''),
      rtt: hop.$.rtt as string | undefined,
    }),
  )

  return {
    ip: addrs[0] ?? 'unknown',
    hostname: hostnames[0],
    mac_address: macAddress,
    status,
    ports,
    os_guess: osGuess,
    os_confidence: osConfidence,
    traceroute: traceHops?.length ? traceHops : undefined,
  }
}

async function runNmap(input: z.infer<InputSchema>, context: ToolUseContext): Promise<Output> {
  const args = buildArgs(input)
  const start = Date.now()
  const targets = input.targets.join(', ')

  const { stdout, stderr, code } = await runNativeWithTask({
    binary: '/usr/sbin/nmap',
    args,
    description: `Nmap ${input.scan_type}: ${targets}`,
    command: `nmap ${args.join(' ')}`,
    timeoutMs: (input.timeout_secs + 10) * 1000,
    setAppState: context.setAppStateForTasks ?? context.setAppState,
    agentId: context.agentId,
    abortSignal: context.abortController.signal,
  })

  if (code !== 0 && !stdout.includes('<?xml')) {
    return {
      hosts: [],
      total_hosts: 0,
      up_hosts: 0,
      scan_args: `nmap ${args.join(' ')}`,
      elapsed_secs: (Date.now() - start) / 1000,
      error: stderr || `nmap exited with code ${code}`,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any
  try {
    parsed = await parseStringPromise(stdout)
  } catch (err) {
    return {
      hosts: [],
      total_hosts: 0,
      up_hosts: 0,
      scan_args: args.join(' '),
      elapsed_secs: (Date.now() - start) / 1000,
      error: `XML parse error: ${err}`,
    }
  }

  const nmaprun = parsed.nmaprun ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawHosts: any[] = nmaprun.host ?? []
  const hosts = rawHosts.map(parseHost)
  const upHosts = hosts.filter(h => h.status === 'up').length

  const runStats = nmaprun.runstats?.[0]
  const elapsed =
    parseFloat(runStats?.finished?.[0]?.$.elapsed ?? '0') || (Date.now() - start) / 1000

  return {
    hosts,
    total_hosts: rawHosts.length,
    up_hosts: upHosts,
    scan_args: `nmap ${args.join(' ')}`,
    elapsed_secs: elapsed,
  }
}

export const NmapTool = buildTool({
  name: NMAP_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'nmap network scan — discover open ports, services, OS fingerprint, NSE vulnerability scripts (vuln/exploit/brute/auth), stealth SYN scan, UDP scan, subnet sweep, CVE detection',
  maxResultSizeChars: 40_000,
  async description(input) {
    const targets = (input as Partial<z.infer<InputSchema>>).targets
    if (targets?.length) return `Nmap scan of ${targets.join(', ')}`
    return 'Network scan with nmap'
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
    return i?.scan_type ? `Nmap:${i.scan_type}` : 'Nmap'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `nmap ${input.targets?.join(' ')} ${input.scan_type ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const targets = input?.targets?.join(', ')
    return targets ? `Scanning ${targets}` : 'Nmap scan'
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const targets = (input as Partial<z.infer<InputSchema>>).targets ?? []
    const type = (input as Partial<z.infer<InputSchema>>).scan_type ?? 'quick'
    return targets.length > 0
      ? `${targets[0]}${targets.length > 1 ? ` +${targets.length - 1}` : ''} (${type})`
      : 'scan'
  },
  renderToolResultMessage,
  async call(input, context) {
    const result = await runNmap(input, context)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error && content.hosts.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Nmap error: ${content.error}`,
      }
    }

    const lines: string[] = [
      `Nmap scan complete — ${content.up_hosts}/${content.total_hosts} hosts up (${content.elapsed_secs.toFixed(1)}s)`,
      `Command: ${content.scan_args}`,
      '',
    ]

    for (const host of content.hosts) {
      if (host.status !== 'up') continue
      lines.push(`Host: ${host.ip}${host.hostname ? ` (${host.hostname})` : ''}`)
      if (host.mac_address) lines.push(`  MAC: ${host.mac_address}`)
      if (host.os_guess)
        lines.push(`  OS: ${host.os_guess}${host.os_confidence ? ` (${host.os_confidence}%)` : ''}`)
      if (host.ports.length === 0) {
        lines.push('  No open ports found')
      } else {
        for (const p of host.ports) {
          const ver = p.version ? ` — ${p.version}` : ''
          const cpe = p.cpe ? ` [${p.cpe}]` : ''
          const reason = p.reason ? ` (${p.reason})` : ''
          lines.push(`  ${p.port}/${p.protocol}  ${p.service}${ver}${cpe}${reason}`)
          for (const s of p.scripts) {
            const scriptLines = s.output.split('\n')
            lines.push(`    [${s.name}] ${scriptLines[0]}`)
            for (const sl of scriptLines.slice(1, 6)) {
              if (sl.trim()) lines.push(`      ${sl.trim()}`)
            }
          }
        }
      }
      if (host.traceroute?.length) {
        lines.push('  Traceroute:')
        for (const hop of host.traceroute) {
          lines.push(`    ${hop.hop}  ${hop.ip}${hop.rtt ? `  ${hop.rtt}ms` : ''}`)
        }
      }
      lines.push('')
    }

    if (content.error) lines.push(`Warning: ${content.error}`)

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
