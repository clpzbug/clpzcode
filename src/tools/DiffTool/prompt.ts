import { DIFF_TOOL_NAME } from './constants.js'

export const PROMPT = `## ${DIFF_TOOL_NAME} — HTTP Response Diff

Compare baseline HTTP responses against injected payloads. Detects blind injection, reflection, timing attacks, and behavior anomalies.

### ESCALATION RULE — Diff findings trigger targeted tools:
- **Score ≥40 on SQLi timing payload** (SLEEP/WAITFOR): immediately → SQLiTool action=dump_dbs
- **Score ≥40 on SSTI math payload** ({{7*7}} reflected as 49): immediately → SSTITool action=identify then exploit
- **Score ≥20 on SSTI or marker reflected**: confirm injection context → run full exploitation chain
- **Status 500 on any injection payload**: error message may contain stack trace or SQL syntax — check body for engine/DB version

### Actions
- \`compare\` — send baseline + each payload, diff status/size/timing/content, score anomalies (0–100)
- \`timing\` — send N samples per payload, flag statistically significant timing deltas (time-based SQLi/SSRF)
- \`reflection\` — check if a unique marker appears in the response body

### Input
- \`url\`: target URL with \`INJECT\` placeholder (e.g. "http://target/page?id=INJECT")
- \`method\`: HTTP method (default: GET)
- \`headers\`: extra headers as object (optional)
- \`body\`: request body template with \`INJECT\` placeholder (optional, for POST)
- \`inject_header\`: inject payload as header value (e.g. "X-Forwarded-For")
- \`payloads\`: array of payloads to test (max 20)
- \`marker\`: unique 8+ char string for reflection (e.g. "clpzXX7k") — check baseline first
- \`samples\`: samples per payload for timing action (default: 3)
- \`timeout_secs\`: per-request timeout (default: 30)

### Anomaly scoring (compare action)
- Status change: +40pts
- Body size delta >100B: +10pts, >500B: up to +30pts
- Timing delta >2s: +10pts, >5s: +30pts
- Error patterns (syntax error, TypeError, stack trace): +15pts
- Payload reflected in body: +20pts

### Examples
- SQLi blind: \`{ url: "http://target/page?id=INJECT", action: "timing", payloads: ["1", "1 AND SLEEP(5)--"] }\`
- SSTI: \`{ url: "http://target/search?q=INJECT", action: "compare", payloads: ["{{7*7}}", "#{7*7}"] }\`
- Reflection: \`{ url: "http://target/page", method: "POST", body: '{"name":"INJECT"}', action: "reflection", marker: "clpzXX7k", payloads: ["clpzXX7k"] }\`
`
