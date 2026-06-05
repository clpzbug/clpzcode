import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { PRIV_ESC_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const STANDARD_SUID_PREFIXES = ['/bin/', '/usr/bin/', '/sbin/', '/usr/sbin/', '/usr/lib/']

// GTFOBins: standard-path binaries exploitable via SUID for privilege escalation.
// Source: https://gtfobins.github.io/#suid
const GTFOBIN_SUID = new Set([
  'bash', 'sh', 'dash', 'zsh',                                     // shells: -p flag preserves EUID
  'python', 'python2', 'python3', 'perl', 'ruby', 'lua', 'php',    // interpreters: exec('/bin/sh')
  'vim', 'vi', 'nano', 'less', 'more', 'man',                      // editors/pagers: shell escape
  'find', 'cp', 'mv', 'chmod', 'chown',                            // file ops: overwrite sensitive files
  'nmap', 'gdb', 'strace',                                          // debug tools: --interactive shell
  'tee', 'dd', 'tar', 'zip', 'unzip',                              // file write: overwrite /etc/passwd
  'curl', 'wget',                                                    // network: write to cron/authorized_keys
  'node', 'ruby', 'awk', 'sed',                                     // scripting
  'ping', 'traceroute',                                              // network utils (rare exploitable)
  'env', 'xargs',                                                    // wrappers: env -i /bin/sh
  'pkexec',                                                          // PwnKit (CVE-2021-4034)
])

function isStandardSuidPath(p: string): boolean {
  return STANDARD_SUID_PREFIXES.some(prefix => p.startsWith(prefix))
}

function isKnownGtfoBin(p: string): boolean {
  const bin = p.split('/').pop() ?? ''
  // Strip version suffixes: python3.9 → python3, python3 → python3
  const base = bin.replace(/[-_]?\d[\d.]*$/, '')
  return GTFOBIN_SUID.has(bin) || GTFOBIN_SUID.has(base)
}

async function runShell(cmd: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('/bin/bash', ['-c', cmd], {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      signal,
    })
    return (stdout + stderr).trim()
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    const out = ((e.stdout ?? '') + (e.stderr ?? '')).trim()
    if (out) return out
    return `error: ${errorMessage(err)}`
  }
}

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

interface Finding {
  check: string
  items: string[]
  severity: Severity
  notes: string
}

const ACTIONS = [
  'suid',
  'sudo',
  'cron',
  'capabilities',
  'path_hijack',
  'writable_dirs',
  'docker',
  'nfs',
  'writable_passwd',
  'polkit',
  'systemd',
  'all',
] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(ACTIONS).describe(
      'suid=SUID/SGID binaries, sudo=sudo -l, cron=crontabs+world-writable, capabilities=getcap, path_hijack=writable PATH dirs, writable_dirs=world-writable dirs, docker=docker.sock/group escape, nfs=no_root_squash exports, writable_passwd=writable /etc/passwd|/etc/shadow, all=run all checks',
    ),
    timeout_secs: z
      .number()
      .int()
      .min(10)
      .max(600)
      .default(60)
      .describe('Timeout per check in seconds (default: 60)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    action: z.string(),
    findings: z.array(
      z.object({
        check: z.string(),
        items: z.array(z.string()),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
        notes: z.string(),
      }),
    ),
    raw_output: z.record(z.string(), z.string()),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function checkSuid(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  const raw = await runShell(
    'find / -perm -4000 -o -perm -2000 2>/dev/null | sort',
    timeoutMs,
    signal,
  )
  const items = raw.split('\n').filter(Boolean)
  const nonStandard = items.filter(p => !isStandardSuidPath(p))
  const gtfoBins = items.filter(p => isKnownGtfoBin(p))
  const severity: Severity = nonStandard.length > 0 ? 'high' : gtfoBins.length > 0 ? 'medium' : 'info'
  const notesParts: string[] = []
  if (nonStandard.length > 0)
    notesParts.push(`${nonStandard.length} non-standard SUID: ${nonStandard.slice(0, 5).join(', ')}`)
  if (gtfoBins.length > 0)
    notesParts.push(`${gtfoBins.length} GTFOBin(s) exploitable via SUID: ${gtfoBins.slice(0, 5).map(p => p.split('/').pop()).join(', ')} — use BinaryAnalysisTool then check GTFOBins.github.io`)
  return {
    raw,
    finding: {
      check: 'suid',
      items,
      severity,
      notes: notesParts.length > 0 ? notesParts.join('. ') : `${items.length} SUID/SGID binaries (all standard, no GTFOBins)`,
    },
  }
}

async function checkSudo(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  const raw = await runShell('sudo -l 2>&1', timeoutMs, signal)
  const lines = raw.split('\n').filter(Boolean)
  const nopasswd = lines.filter(l => l.includes('NOPASSWD'))
  const nopasswdGtfo = nopasswd.filter(l => isKnownGtfoBin(l))
  const severity: Severity =
    nopasswd.length > 0 ? 'critical' : raw.includes('may run') ? 'high' : 'info'
  const notes =
    nopasswdGtfo.length > 0
      ? `NOPASSWD GTFOBin(s) — instant root: ${nopasswdGtfo.slice(0, 3).join(', ')}`
      : nopasswd.length > 0
        ? `NOPASSWD sudo entries: ${nopasswd.join(', ')}`
        : 'No NOPASSWD sudo entries detected'
  return {
    raw,
    finding: {
      check: 'sudo',
      items: lines,
      severity,
      notes,
    },
  }
}

async function checkCron(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  const raw = await runShell(
    `echo "=== /etc/crontab ===" && cat /etc/crontab 2>/dev/null; echo "=== /etc/cron.d/ ==="  && ls -la /etc/cron.d/ 2>/dev/null && cat /etc/cron.d/* 2>/dev/null; echo "=== User crontabs ===" && ls /var/spool/cron/crontabs/ 2>/dev/null; echo "=== World-writable ===" && find /etc/cron* /var/spool/cron -writable 2>/dev/null`,
    timeoutMs,
    signal,
  )
  const writableSection = raw.split('=== World-writable ===')[1] ?? ''
  const writableItems = writableSection.split('\n').filter(Boolean)
  const severity: Severity = writableItems.length > 0 ? 'critical' : 'info'
  return {
    raw,
    finding: {
      check: 'cron',
      items: raw.split('\n').filter(Boolean),
      severity,
      notes:
        writableItems.length > 0
          ? `${writableItems.length} world-writable cron script(s): ${writableItems.join(', ')}`
          : 'No world-writable cron scripts found',
    },
  }
}

async function checkCapabilities(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  const raw = await runShell('getcap -r / 2>/dev/null', timeoutMs, signal)
  const items = raw.split('\n').filter(Boolean)
  // Capabilities that directly enable privilege escalation or sensitive data access
  const DANGEROUS_CAPS = [
    'cap_setuid',        // change UID → become root
    'cap_setgid',        // change GID → join privileged group
    'cap_sys_admin',     // near-unlimited: mount, ptrace, nsenter, etc.
    'cap_dac_read_search',// read any file/dir regardless of permissions → /etc/shadow, SSH keys
    'cap_dac_override',  // read+write any file → inject root cron, overwrite passwd
    'cap_sys_ptrace',    // attach to any process → credential theft from memory (GDB/strace)
    'cap_chown',         // change ownership of any file → make SUID binary owned by root
    'cap_fowner',        // bypass owner permission checks → modify any file
    'cap_net_raw',       // raw sockets → ARP poisoning, packet injection
    'cap_net_admin',     // full network control → traffic intercept
  ]
  const dangerous = items.filter(l => DANGEROUS_CAPS.some(cap => l.includes(cap)))
  const severity: Severity =
    dangerous.length > 0 ? 'critical' : items.length > 0 ? 'medium' : 'info'
  return {
    raw,
    finding: {
      check: 'capabilities',
      items,
      severity,
      notes:
        dangerous.length > 0
          ? `Dangerous capabilities: ${dangerous.join(', ')}`
          : items.length > 0
            ? `${items.length} capability entries found`
            : 'No special capabilities found',
    },
  }
}

async function checkPathHijack(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  const raw = await runShell(
    `echo $PATH | tr ':' '\\n' | while read d; do [ -d "$d" ] && [ -w "$d" ] && echo "WRITABLE: $d"; done`,
    timeoutMs,
    signal,
  )
  const writableDirs = raw.split('\n').filter(l => l.startsWith('WRITABLE:'))
  const severity: Severity = writableDirs.length > 0 ? 'high' : 'info'
  return {
    raw,
    finding: {
      check: 'path_hijack',
      items: writableDirs,
      severity,
      notes:
        writableDirs.length > 0
          ? `Writable PATH directories: ${writableDirs.join(', ')}`
          : 'No writable directories in PATH',
    },
  }
}

async function checkWritableDirs(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  const raw = await runShell(
    "find / -writable -type d 2>/dev/null | grep -v -E '^/proc|^/sys|^/dev|^/run|^/tmp|^/var/tmp' | head -50",
    timeoutMs,
    signal,
  )
  const items = raw.split('\n').filter(Boolean)
  const severity: Severity = items.length > 5 ? 'medium' : items.length > 0 ? 'low' : 'info'
  return {
    raw,
    finding: {
      check: 'writable_dirs',
      items,
      severity,
      notes: `${items.length} world-writable directories (excl. /proc, /sys, /dev, /run, /tmp)`,
    },
  }
}

/**
 * Classify a docker-based privilege-escalation vector from `id` output and a
 * docker.sock writability probe. Membership in the `docker` group or a
 * writable `/var/run/docker.sock` is effectively root (mount host / in a
 * container). Pure function for testability.
 */
function analyzeDocker(idAndSockOutput: string): { items: string[]; severity: Severity; notes: string } {
  const items: string[] = []
  if (/\(docker\)/.test(idAndSockOutput)) {
    items.push('User is in the docker group — `docker run -v /:/host` yields host root')
  }
  if (idAndSockOutput.includes('WRITABLE: /var/run/docker.sock')) {
    items.push('/var/run/docker.sock is writable — Docker API access = host root')
  }
  const severity: Severity = items.length > 0 ? 'critical' : 'info'
  return { items, severity, notes: items.length > 0 ? items.join('; ') : 'No docker-based escalation vector' }
}

async function checkDocker(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  const raw = await runShell(
    'id 2>/dev/null; test -w /var/run/docker.sock 2>/dev/null && echo "WRITABLE: /var/run/docker.sock"; ls -la /var/run/docker.sock 2>/dev/null',
    timeoutMs,
    signal,
  )
  const a = analyzeDocker(raw)
  return { raw, finding: { check: 'docker', items: a.items, severity: a.severity, notes: a.notes } }
}

/**
 * Detect NFS exports configured with `no_root_squash`, which lets a remote
 * root user write files owned by root on the share (drop a SUID-root binary).
 * Comment lines are ignored. Pure function for testability.
 */
function analyzeNfsExports(exportsContent: string): { items: string[]; severity: Severity; notes: string } {
  const lines = exportsContent.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
  const items = lines.filter(l => l.includes('no_root_squash')).map(l => l.trim())
  const severity: Severity = items.length > 0 ? 'high' : 'info'
  return {
    items,
    severity,
    notes:
      items.length > 0
        ? `${items.length} NFS export(s) with no_root_squash — mount remotely and write a SUID-root binary`
        : 'No no_root_squash NFS exports',
  }
}

async function checkNfs(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  const raw = await runShell(
    'cat /etc/exports 2>/dev/null; echo "=== showmount ==="; showmount -e localhost 2>/dev/null',
    timeoutMs,
    signal,
  )
  const a = analyzeNfsExports(raw)
  return { raw, finding: { check: 'nfs', items: a.items, severity: a.severity, notes: a.notes } }
}

/**
 * Classify writable `/etc/passwd` (append a uid-0 user) or `/etc/shadow`
 * (overwrite root hash / exfil hashes). Pure function for testability.
 */
function analyzeWritablePasswd(testOutput: string): { items: string[]; severity: Severity; notes: string } {
  const items: string[] = []
  if (testOutput.includes('WRITABLE: /etc/passwd')) {
    items.push('/etc/passwd is writable — append a uid-0 user (openssl passwd -1)')
  }
  if (testOutput.includes('WRITABLE: /etc/shadow')) {
    items.push('/etc/shadow is writable — overwrite root hash or exfiltrate hashes to crack')
  }
  const severity: Severity = items.length > 0 ? 'critical' : 'info'
  return {
    items,
    severity,
    notes: items.length > 0 ? items.join('; ') : '/etc/passwd and /etc/shadow are not writable',
  }
}

async function checkWritablePasswd(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  const raw = await runShell(
    'for f in /etc/passwd /etc/shadow; do test -w "$f" 2>/dev/null && echo "WRITABLE: $f"; done; ls -la /etc/passwd /etc/shadow 2>/dev/null',
    timeoutMs,
    signal,
  )
  const a = analyzeWritablePasswd(raw)
  return { raw, finding: { check: 'writable_passwd', items: a.items, severity: a.severity, notes: a.notes } }
}

async function checkPolkit(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  // Check pkexec SUID (PwnKit CVE-2021-4034) and polkit version
  const raw = await runShell(
    'pkexec --version 2>/dev/null; stat /usr/bin/pkexec 2>/dev/null | grep "Access:"; dpkg -l policykit-1 2>/dev/null | tail -1; rpm -q polkit 2>/dev/null',
    timeoutMs,
    signal,
  )
  // Polkit < 0.120 and pkexec SUID = PwnKit (instant local root on unpatched systems)
  const hasSuid = raw.includes('-rws') || raw.includes('4755') || raw.includes('4511')
  // Match polkit < 0.120: includes 0.0xx, 0.10x, 0.11x (but not 0.120+)
  const oldVersion = /0\.(0\d\d|10\d|11[0-9])\b/.test(raw)
  const critical = hasSuid && oldVersion
  return {
    raw,
    finding: {
      check: 'polkit',
      items: raw.split('\n').filter(Boolean),
      severity: critical ? 'critical' : hasSuid ? 'medium' : 'info',
      notes: critical
        ? 'PwnKit candidate: pkexec is SUID + polkit < 0.120 — CVE-2021-4034 likely exploitable for local root'
        : hasSuid
          ? 'pkexec is SUID — verify polkit version for CVE-2021-4034 (PwnKit)'
          : 'pkexec not SUID or not found',
    },
  }
}

async function checkSystemd(timeoutMs: number, signal?: AbortSignal): Promise<{ finding: Finding; raw: string }> {
  // Check for world-writable or user-writable systemd service files
  const raw = await runShell(
    `find /etc/systemd /lib/systemd /usr/lib/systemd -name "*.service" -writable 2>/dev/null | head -20; \
     find /home -name "*.service" 2>/dev/null | head -10; \
     systemctl show --property=ExecStart -- $(systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}' | head -10) 2>/dev/null | grep ExecStart | head -10`,
    timeoutMs,
    signal,
  )
  const writableServices = raw.split('\n').filter(l => l.includes('.service') && l.trim())
  const severity: Severity = writableServices.length > 0 ? 'critical' : 'info'
  return {
    raw,
    finding: {
      check: 'systemd',
      items: writableServices,
      severity,
      notes: writableServices.length > 0
        ? `${writableServices.length} writable systemd service file(s) — modify ExecStart to inject commands run as root`
        : 'No writable systemd service files found',
    },
  }
}

async function runChecks(
  action: (typeof ACTIONS)[number],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ findings: Finding[]; raw: Record<string, string> }> {
  const checkFns: Array<() => Promise<{ finding: Finding; raw: string }>> = []

  if (action === 'all' || action === 'suid') checkFns.push(() => checkSuid(timeoutMs, signal))
  if (action === 'all' || action === 'sudo') checkFns.push(() => checkSudo(timeoutMs, signal))
  if (action === 'all' || action === 'cron') checkFns.push(() => checkCron(timeoutMs, signal))
  if (action === 'all' || action === 'capabilities') checkFns.push(() => checkCapabilities(timeoutMs, signal))
  if (action === 'all' || action === 'path_hijack') checkFns.push(() => checkPathHijack(timeoutMs, signal))
  if (action === 'all' || action === 'writable_dirs') checkFns.push(() => checkWritableDirs(timeoutMs, signal))
  if (action === 'all' || action === 'docker') checkFns.push(() => checkDocker(timeoutMs, signal))
  if (action === 'all' || action === 'nfs') checkFns.push(() => checkNfs(timeoutMs, signal))
  if (action === 'all' || action === 'writable_passwd') checkFns.push(() => checkWritablePasswd(timeoutMs, signal))
  if (action === 'all' || action === 'polkit') checkFns.push(() => checkPolkit(timeoutMs, signal))
  if (action === 'all' || action === 'systemd') checkFns.push(() => checkSystemd(timeoutMs, signal))

  const results = await Promise.allSettled(checkFns.map(fn => fn()))
  const findings: Finding[] = []
  const raw: Record<string, string> = {}

  for (const r of results) {
    if (r.status === 'fulfilled') {
      findings.push(r.value.finding)
      raw[r.value.finding.check] = r.value.raw
    } else {
      logForDebugging(`PrivEscTool check failed: ${errorMessage(r.reason)}`)
    }
  }

  const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  return { findings, raw }
}

export const PrivEscTool = buildTool({
  name: PRIV_ESC_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'privesc — Linux privilege escalation: SUID, sudo, cron, capabilities, writable PATH, docker socket, NFS no_root_squash, writable passwd/shadow, polkit PwnKit CVE-2021-4034, writable systemd service',
  maxResultSizeChars: 40_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i.action ?? 'all'
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
    return i?.action ? `PrivEsc:${i.action}` : 'PrivEsc'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `privesc ${i?.action ?? 'all'}`
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
    return `PrivEsc: ${i?.action ?? 'all'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `PrivEsc ${i.action ?? 'all'}: checar vetores de escalada`
  },
  renderToolResultMessage,
  async call(input, context) {
    try {
      const timeoutMs = (input.timeout_secs ?? 60) * 1000
      const { findings, raw } = await runChecks(input.action, timeoutMs, context.abortController.signal)
      return {
        data: {
          action: input.action,
          findings,
          raw_output: raw,
        },
      }
    } catch (err: unknown) {
      logForDebugging(`PrivEscTool error: ${errorMessage(err)}`)
      return {
        data: {
          action: input.action,
          findings: [],
          raw_output: {},
          error: errorMessage(err),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    const lines: string[] = [`PrivEsc: ${content.action}`, '']

    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }

    const severityTag: Record<string, string> = {
      critical: '[CRITICAL]',
      high: '[HIGH]',
      medium: '[MEDIUM]',
      low: '[LOW]',
      info: '[INFO]',
    }

    for (const f of content.findings) {
      const tag = severityTag[f.severity] ?? '[?]'
      lines.push(`${tag} ${f.check.toUpperCase()}: ${f.notes}`)
      if (f.items.length > 0 && f.severity !== 'info') {
        const preview = f.items.slice(0, 10)
        for (const item of preview) lines.push(`  ${item}`)
        if (f.items.length > 10) lines.push(`  ... and ${f.items.length - 10} more`)
      }
      lines.push('')
    }

    if (content.findings.length === 0) {
      lines.push('No findings.')
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)

// Exported for testing only
export const __test = { isStandardSuidPath, isKnownGtfoBin, analyzeDocker, analyzeNfsExports, analyzeWritablePasswd }
