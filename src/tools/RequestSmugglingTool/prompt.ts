import { REQUEST_SMUGGLING_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `HTTP Request Smuggling detector — tests CL.TE, TE.CL, TE.TE variants and timing-based detection.`

export const PROMPT = `## ${REQUEST_SMUGGLING_TOOL_NAME} — HTTP Request Smuggling Detection

HTTP Request Smuggling occurs when front-end and back-end servers disagree on where HTTP requests end.

### ESCALATION RULE — Confirmed smuggling is high-impact:
1. Detect with action=all first
2. If confirmed: chain to internal header injection (add X-Internal-Admin: true, X-Real-IP: 127.0.0.1 to smuggled prefix)
3. Test cache poisoning via smuggling: smuggle a request that poisons a cacheable path for other users
4. Test bypass of access controls: smuggle a GET /admin or POST to internal endpoints
5. Then call ChainTool bug_class=ssrf for the next escalation vector (smuggling gives access to internal endpoints)

### Actions
- \`detect_clte\` — Content-Length / Transfer-Encoding conflict (CL.TE)
- \`detect_tecl\` — Transfer-Encoding / Content-Length conflict (TE.CL)
- \`detect_tete\` — Dual Transfer-Encoding obfuscation (TE.TE)
- \`timing\` — Differential timing attack (10s+ delta = likely vulnerable)
- \`all\` — Run all detection methods sequentially

### Evidence interpretation
- HTTP 400/408/500 with unusual body → parser confusion
- Response time > 5s longer than baseline → timing attack confirms CL.TE or TE.CL
- Different response body from normal → smuggled prefix is being processed

### Examples
- \`{ url: "https://target.com/", action: "all" }\`
- \`{ url: "https://target.com/api", action: "timing" }\`
`
