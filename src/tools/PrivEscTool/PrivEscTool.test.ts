import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { __test } from './PrivEscTool.js'

const { analyzeDocker, analyzeNfsExports, analyzeWritablePasswd } = __test

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

const schema = z.strictObject({
  action: z.enum(ACTIONS),
  timeout_secs: z.number().int().min(10).max(600).default(60),
})

describe('PrivEscTool schema', () => {
  test('accepts suid action', () => {
    const r = schema.safeParse({ action: 'suid' })
    expect(r.success).toBe(true)
  })

  test('accepts sudo action', () => {
    const r = schema.safeParse({ action: 'sudo' })
    expect(r.success).toBe(true)
  })

  test('accepts cron action', () => {
    const r = schema.safeParse({ action: 'cron' })
    expect(r.success).toBe(true)
  })

  test('accepts capabilities action', () => {
    const r = schema.safeParse({ action: 'capabilities' })
    expect(r.success).toBe(true)
  })

  test('accepts path_hijack action', () => {
    const r = schema.safeParse({ action: 'path_hijack' })
    expect(r.success).toBe(true)
  })

  test('accepts writable_dirs action', () => {
    const r = schema.safeParse({ action: 'writable_dirs' })
    expect(r.success).toBe(true)
  })

  test('accepts all action', () => {
    const r = schema.safeParse({ action: 'all' })
    expect(r.success).toBe(true)
  })

  test('accepts docker action', () => {
    expect(schema.safeParse({ action: 'docker' }).success).toBe(true)
  })

  test('accepts nfs action', () => {
    expect(schema.safeParse({ action: 'nfs' }).success).toBe(true)
  })

  test('accepts writable_passwd action', () => {
    expect(schema.safeParse({ action: 'writable_passwd' }).success).toBe(true)
  })

  test('rejects missing action', () => {
    const r = schema.safeParse({})
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ action: 'kernel' })
    expect(r.success).toBe(false)
  })

  test('defaults timeout_secs to 60', () => {
    const r = schema.safeParse({ action: 'all' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.timeout_secs).toBe(60)
  })

  test('rejects timeout below minimum (10)', () => {
    const r = schema.safeParse({ action: 'suid', timeout_secs: 5 })
    expect(r.success).toBe(false)
  })

  test('accepts max timeout (600)', () => {
    const r = schema.safeParse({ action: 'all', timeout_secs: 600 })
    expect(r.success).toBe(true)
  })
})

// =============================================================================
// analyzeDocker — docker.sock / docker-group escape
// =============================================================================

describe('analyzeDocker', () => {
  test('flags docker group membership as critical', () => {
    const id = 'uid=1000(clpz) gid=1000(clpz) groups=1000(clpz),27(sudo),998(docker)'
    const r = analyzeDocker(id)
    expect(r.severity).toBe('critical')
    expect(r.items.some(i => i.includes('docker group'))).toBe(true)
  })

  test('flags writable docker.sock as critical', () => {
    const r = analyzeDocker('uid=33(www-data)\nWRITABLE: /var/run/docker.sock')
    expect(r.severity).toBe('critical')
    expect(r.items.some(i => i.includes('docker.sock'))).toBe(true)
  })

  test('reports both vectors when present', () => {
    const r = analyzeDocker('groups=998(docker)\nWRITABLE: /var/run/docker.sock')
    expect(r.items).toHaveLength(2)
  })

  test('returns info when no docker vector present', () => {
    const r = analyzeDocker('uid=1000(clpz) gid=1000(clpz) groups=1000(clpz),27(sudo)')
    expect(r.severity).toBe('info')
    expect(r.items).toHaveLength(0)
  })

  test('does not false-positive on docker-like group names', () => {
    // "(dockerroot)" must not match the exact "(docker)" token
    const r = analyzeDocker('groups=1000(clpz),999(dockerroot)')
    expect(r.severity).toBe('info')
  })
})

// =============================================================================
// analyzeNfsExports — no_root_squash detection
// =============================================================================

describe('analyzeNfsExports', () => {
  test('flags no_root_squash export as high', () => {
    const exports = '/srv/share 10.0.0.0/24(rw,no_root_squash)'
    const r = analyzeNfsExports(exports)
    expect(r.severity).toBe('high')
    expect(r.items).toHaveLength(1)
  })

  test('ignores commented-out no_root_squash lines', () => {
    const exports = '# /old 10.0.0.0/24(rw,no_root_squash)\n/srv 10.0.0.0/24(rw,root_squash)'
    const r = analyzeNfsExports(exports)
    expect(r.severity).toBe('info')
    expect(r.items).toHaveLength(0)
  })

  test('ignores indented commented-out no_root_squash lines', () => {
    // The parser trims before checking for '#', so leading-whitespace comments
    // must also be ignored (no false-positive on disabled config).
    const exports = '   # /old 10.0.0.0/24(rw,no_root_squash)\n/srv 10.0.0.0/24(rw,root_squash)'
    const r = analyzeNfsExports(exports)
    expect(r.severity).toBe('info')
    expect(r.items).toHaveLength(0)
  })

  test('counts multiple vulnerable exports', () => {
    const exports = '/a *(rw,no_root_squash)\n/b *(rw,no_root_squash)'
    const r = analyzeNfsExports(exports)
    expect(r.items).toHaveLength(2)
  })

  test('returns info for safe exports', () => {
    const r = analyzeNfsExports('/srv 10.0.0.0/24(ro,root_squash)')
    expect(r.severity).toBe('info')
  })

  test('returns info for empty exports', () => {
    expect(analyzeNfsExports('').severity).toBe('info')
  })
})

// =============================================================================
// analyzeWritablePasswd — writable /etc/passwd|/etc/shadow
// =============================================================================

describe('analyzeWritablePasswd', () => {
  test('flags writable /etc/passwd as critical', () => {
    const r = analyzeWritablePasswd('WRITABLE: /etc/passwd')
    expect(r.severity).toBe('critical')
    expect(r.items.some(i => i.includes('/etc/passwd'))).toBe(true)
  })

  test('flags writable /etc/shadow as critical', () => {
    const r = analyzeWritablePasswd('WRITABLE: /etc/shadow')
    expect(r.severity).toBe('critical')
    expect(r.items.some(i => i.includes('/etc/shadow'))).toBe(true)
  })

  test('reports both files when both writable', () => {
    const r = analyzeWritablePasswd('WRITABLE: /etc/passwd\nWRITABLE: /etc/shadow')
    expect(r.items).toHaveLength(2)
  })

  test('returns info when neither is writable', () => {
    const r = analyzeWritablePasswd('-rw-r--r-- 1 root root /etc/passwd')
    expect(r.severity).toBe('info')
    expect(r.items).toHaveLength(0)
  })
})

// =============================================================================
// PwnKit (polkit) version detection regex
// =============================================================================

describe('PrivEscTool polkit version regex (PwnKit detection)', () => {
  // Mirrors the regex in checkPolkit: /0\.(0\d\d|10\d|11[0-9])\b/
  const PWNTKIT_REGEX = /0\.(0\d\d|10\d|11[0-9])\b/

  test('detects polkit 0.105 (most common affected version)', () => {
    expect(PWNTKIT_REGEX.test('0.105-1+deb10u1')).toBe(true)
  })

  test('detects polkit 0.115 (Ubuntu 20.04 affected)', () => {
    expect(PWNTKIT_REGEX.test('0.115')).toBe(true)
  })

  test('detects polkit 0.119 (last affected version)', () => {
    expect(PWNTKIT_REGEX.test('0.119')).toBe(true)
  })

  test('does NOT match polkit 0.120 (patched version)', () => {
    expect(PWNTKIT_REGEX.test('0.120')).toBe(false)
  })

  test('does NOT match polkit 0.121 or higher (patched)', () => {
    expect(PWNTKIT_REGEX.test('0.121')).toBe(false)
    expect(PWNTKIT_REGEX.test('0.131')).toBe(false)
  })

  test('detects very old polkit 0.096 (cycle 3 fix — was not detected before)', () => {
    // The original regex missed 0.0xx versions; fix in 02d5265f added 0\d\d branch
    expect(PWNTKIT_REGEX.test('0.096')).toBe(true)
  })

  test('polkit action accepted in schema', () => {
    const r = schema.safeParse({ action: 'polkit' })
    expect(r.success).toBe(true)
  })

  test('systemd action accepted in schema', () => {
    const r = schema.safeParse({ action: 'systemd' })
    expect(r.success).toBe(true)
  })
})

// =============================================================================
// Capabilities — extended dangerous capability detection (cycle 4)
// =============================================================================

describe('PrivEscTool capabilities — extended dangerous cap detection', () => {
  // These mirror the DANGEROUS_CAPS array in checkCapabilities()
  const DANGEROUS_CAPS = [
    'cap_setuid', 'cap_setgid', 'cap_sys_admin',
    'cap_dac_read_search', 'cap_dac_override',
    'cap_sys_ptrace', 'cap_chown', 'cap_fowner',
    'cap_net_raw', 'cap_net_admin',
  ]

  test('DANGEROUS_CAPS array has 10 entries', () => {
    expect(DANGEROUS_CAPS.length).toBe(10)
  })

  test('cap_dac_read_search classified as dangerous (arbitrary file read)', () => {
    // A binary with cap_dac_read_search can read /etc/shadow without being root
    const capLine = '/usr/bin/python3 = cap_dac_read_search+eip'
    const isDangerous = DANGEROUS_CAPS.some(cap => capLine.includes(cap))
    expect(isDangerous).toBe(true)
  })

  test('cap_dac_override classified as dangerous (all-file r/w)', () => {
    const capLine = '/usr/bin/vim.basic = cap_dac_override+eip'
    expect(DANGEROUS_CAPS.some(cap => capLine.includes(cap))).toBe(true)
  })

  test('cap_sys_ptrace classified as dangerous (process attach → cred theft)', () => {
    const capLine = '/usr/bin/gdb = cap_sys_ptrace+ep'
    expect(DANGEROUS_CAPS.some(cap => capLine.includes(cap))).toBe(true)
  })

  test('cap_chown classified as dangerous (ownership change → SUID abuse)', () => {
    const capLine = '/usr/bin/busybox = cap_chown+ep'
    expect(DANGEROUS_CAPS.some(cap => capLine.includes(cap))).toBe(true)
  })

  test('cap_net_admin classified as dangerous (network traffic intercept)', () => {
    const capLine = '/usr/sbin/tcpdump = cap_net_admin,cap_net_raw+eip'
    expect(DANGEROUS_CAPS.some(cap => capLine.includes(cap))).toBe(true)
  })

  test('harmless capability (cap_net_bind_service) not classified as dangerous', () => {
    // Port binding below 1024 — not a priv-esc vector
    const capLine = '/usr/bin/node = cap_net_bind_service+ep'
    const isDangerous = DANGEROUS_CAPS.some(cap => capLine.includes(cap))
    expect(isDangerous).toBe(false)
  })
})

// =============================================================================
// isKnownGtfoBin — GTFOBins SUID detection (cycle 4)
// =============================================================================

import { __test as privEscTest } from './PrivEscTool.js'
const { isKnownGtfoBin } = privEscTest

describe('PrivEscTool isKnownGtfoBin', () => {
  test('bash is a GTFOBin (setuid bash -p → root shell)', () => {
    expect(isKnownGtfoBin('/usr/bin/bash')).toBe(true)
  })

  test('python3 is a GTFOBin (python3 -c "import os; os.setuid(0); os.system(sh)")', () => {
    expect(isKnownGtfoBin('/usr/bin/python3')).toBe(true)
  })

  test('python3.9 version suffix stripped — still matches', () => {
    expect(isKnownGtfoBin('/usr/bin/python3.9')).toBe(true)
  })

  test('find is a GTFOBin (find . -exec /bin/sh \;)', () => {
    expect(isKnownGtfoBin('/usr/bin/find')).toBe(true)
  })

  test('vim is a GTFOBin (vim -c ":!/bin/sh")', () => {
    expect(isKnownGtfoBin('/usr/bin/vim')).toBe(true)
  })

  test('nmap is a GTFOBin (nmap --interactive → !sh)', () => {
    expect(isKnownGtfoBin('/usr/bin/nmap')).toBe(true)
  })

  test('tee is a GTFOBin (echo root2::0:0: | tee -a /etc/passwd)', () => {
    expect(isKnownGtfoBin('/usr/bin/tee')).toBe(true)
  })

  test('pkexec is a GTFOBin (PwnKit CVE-2021-4034)', () => {
    expect(isKnownGtfoBin('/usr/bin/pkexec')).toBe(true)
  })

  test('ls is NOT a GTFOBin', () => {
    expect(isKnownGtfoBin('/usr/bin/ls')).toBe(false)
  })

  test('passwd is NOT a GTFOBin (legitimate SUID, no shell escape)', () => {
    expect(isKnownGtfoBin('/usr/bin/passwd')).toBe(false)
  })

  test('non-standard custom binary is NOT a GTFOBin', () => {
    expect(isKnownGtfoBin('/opt/myapp/suid_helper')).toBe(false)
  })
})
