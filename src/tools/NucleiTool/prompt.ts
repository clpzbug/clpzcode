import { NUCLEI_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Vulnerability scanner using nuclei with 13,000+ templates. Returns structured findings by severity.`

export const PROMPT = `## ${NUCLEI_TOOL_NAME} — Vulnerability scanning with 13,000+ templates

Runs nuclei against targets and returns structured findings. Use this for CVE scanning, exposed services, misconfigurations, default credentials, DAST, and more.

### ESCALATION RULE — Nuclei findings must be exploited, not just reported:
- **RCE CVE detected**: immediately run Bash to reproduce the PoC command from the template; if it echoes RCE output, call PrivEscTool + CredHarvestTool
- **Default credentials**: use BruteForceTool to spray them across all exposed services (SSH, RDP, DB)
- **SSTI detected**: use SSTITool action=exploit — do not stop at detection
- **SQLi detected**: use SQLiTool action=dump_dbs then extra_args="--os-shell"
- **SSRF detected**: use SSRFTool action=scan for full cloud metadata + internal network pivot
- **LFI detected**: ChainTool bug_class=lfi for log poisoning / PHP wrapper RCE chain
- **Exposed admin panel**: use BruteForceTool http-post-form with top100 wordlist
- **Subdomain takeover**: verify by claiming the resource (NS/CNAME target registration)

### profiles (curated template sets)
- \`pentest\` — full pentest: http+tcp+js+dns+ssl (excludes dos/fuzz/osint) ← recommended for engagements
- \`recommended\` — critical+high+med+low across all protocol types
- \`cves\` — CVE templates only
- \`kev\` — CISA Known Exploited Vulnerabilities (highest priority)
- \`default-login\` — default credentials across 200+ products
- \`misconfigs\` — misconfigurations (headers, permissions, debug endpoints)
- \`wordpress\` — WordPress + plugins + themes
- \`cloud\` — AWS/Azure/GCP/K8s misconfiguration
- \`compliance\` — security compliance checks
- \`windows\` — Windows audit templates
- \`osint\` — OSINT / public exposure
- \`takeovers\` — subdomain takeover
- \`priv-esc\` — privilege escalation
- \`ai\` — AI/LLM infrastructure security
- \`all\` — all 13,000+ templates (slow)
- Cloud-provider specific (use after gaining cloud access via SSRF):
  \`aws\`, \`gcp\`, \`azure\`, \`alibaba\`, \`k8s\` — provider-specific misconfig checks

### template shortcuts (directory-based)
- \`http/cves\` — HTTP CVEs (2000–2026, 3000+ templates)
- \`http/vulnerabilities\` — product-specific vulns (RCE, SQLi, XSS, LFI…)
- \`http/exposures\` — configs, backups, API keys, tokens exposed
- \`http/misconfiguration\` — server/app misconfigs
- \`http/default-logins\` — default credentials (200+ products)
- \`http/exposed-panels\` — admin panels exposed without auth
- \`http/technologies\` — tech/version fingerprinting
- \`http/takeovers\` — subdomain takeover detection
- \`http/fuzzing\` — parameter fuzzing
- \`dast\` — dynamic application security testing (XSS, SQLi, SSRF, SSTI)
- \`dast/vulnerabilities\` — all DAST injection templates
- \`dast/ssti\` — SSTI payloads across all common template engines
- \`dast/sqli\` — SQL injection DAST probes
- \`dast/ssrf\` — SSRF DAST detection
- \`dast/lfi\` — LFI/path traversal detection
- \`dast/cmdi\` — OS command injection
- \`dast/redirect\` — open redirect detection
- \`network/cves\` — network-level CVEs
- \`ssl\` — SSL/TLS misconfigurations
- \`dns\` — DNS misconfigurations, zone transfer
- \`cloud\` — cloud provider misconfiguration
- \`javascript\` — JavaScript-protocol templates
- \`headless\` — browser-based templates (JS-heavy apps)
- \`file/keys\` — exposed private keys in files

### severity filter
info, low, medium, high, critical. Default: medium,high,critical for profile scans.

### Special options
- \`auto_scan: true\` (-as flag) — automatic technology detection via wappalyzer, then runs matching templates. Best for unknown targets where you don't know the stack.
- \`no_interactsh: true\` — disable OOB callbacks (use in air-gapped environments)
- \`proxy\` — route through Burp Suite or mitmproxy for manual review
- \`headers\` — inject auth headers (e.g. {"Authorization":"Bearer token"})

### Common tag filters
rce, sqli, xss, lfi, ssrf, ssti, xxe, idor, auth-bypass, default-login, misconfig, exposure, cve, tech

### Examples
- Pentest engagement: \`{ targets: ["https://target.com"], profile: "pentest" }\`
- CVE check only: \`{ targets: ["https://target.com"], profile: "cves", severity: ["critical","high"] }\`
- Quick CISA KEV: \`{ targets: ["https://target.com"], profile: "kev" }\`
- Default creds: \`{ targets: ["https://target.com"], profile: "default-login" }\`
- DAST all vulns: \`{ targets: ["https://target.com"], templates: ["dast/vulnerabilities"], severity: ["high","critical"] }\`
- SSTI-only DAST (after ReconTool finds template endpoint): \`{ targets: ["https://target.com/render?q=test"], templates: ["dast/ssti"] }\`
- SQLi-only DAST (login or search endpoints): \`{ targets: ["https://target.com/login"], templates: ["dast/sqli"] }\`
- Specific CVEs RCE: \`{ targets: ["https://target.com"], tags: ["cve","rce"], severity: ["critical"] }\`
- Exposed configs: \`{ targets: ["https://target.com"], templates: ["http/exposures","http/misconfiguration"] }\`
- WordPress scan: \`{ targets: ["https://target.com"], profile: "wordpress" }\`
- Full no-noise: \`{ targets: ["https://target.com"], profile: "pentest", severity: ["high","critical"], rate_limit: 100 }\`
`
