import { WEBSOCKET_TOOL_NAME } from './constants.js'

export const PROMPT = `## ${WEBSOCKET_TOOL_NAME} — WebSocket Security Testing

### ESCALATION RULE — Confirmed CSWSH leads to account takeover:
1. action=scan — runs all probes (upgrade, cswsh, auth) sequentially
2. If cswsh is CRITICAL (foreign origin accepted): attacker page can silently hijack victim's authenticated WS session — exfiltrate real-time data, inject messages
3. If auth is HIGH (no-auth upgrade accepted): any user can connect without credentials — check what data is accessible or what actions can be taken
4. After confirming: chain to ChainTool bug_class=stored-xss (inject payload via WS that fires in the admin UI)

### Actions
- \`upgrade\` — probe if WebSocket upgrade is accepted at all (HTTP 101 Switching Protocols)
- \`cswsh\` — Cross-Site WebSocket Hijacking: test if foreign origin is accepted for WS upgrade (session hijacking vector)
- \`auth\` — check if WS upgrade is accepted without authentication credentials
- \`scan\` — run all three actions sequentially (recommended first pass)

### Input
- \`url\`: WebSocket URL (ws:// or wss://)
- \`action\`: upgrade | cswsh | auth | scan
- \`origin\`: Origin header for cswsh test (default: https://evil.com)
- \`cookie\`: Session cookie for auth comparison test
- \`headers\`: custom HTTP headers (e.g. Authorization: Bearer token)
- \`timeout_secs\`: timeout per probe (default: 15)

### Examples
- \`{ url: "wss://target.com/ws", action: "scan" }\`
- \`{ url: "wss://target.com/ws", action: "cswsh", origin: "https://attacker.com" }\`
- \`{ url: "wss://target.com/ws", action: "auth", cookie: "session=abc123" }\`
`
