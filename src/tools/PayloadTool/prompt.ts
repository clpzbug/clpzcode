import { PAYLOAD_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Browse PayloadsAllTheThings. List categories or retrieve payloads for a vulnerability class.`

export const PROMPT = `## ${PAYLOAD_TOOL_NAME} — Payload library from PayloadsAllTheThings

Reads from /usr/share/payloadsallthethings/ to retrieve attack payloads by category.
Use this when SSTITool/SQLiTool payloads fail and you need alternatives, or to find
specific bypass techniques.

### Operations
- \`list\` — list all available categories
- \`get\` — retrieve content for a specific category (requires \`category\`)
- \`search\` — search payloads across all categories (requires \`query\`)

### Category guide by vuln class (use exact names from list):
- **SSTI → RCE**: "Server Side Template Injection" — engine-specific payloads
- **SQLi → OS shell**: "SQL Injection" → search "INTO OUTFILE" or "xp_cmdshell"
- **Command injection bypass**: "Command Injection" — filter bypass techniques
- **Deserialization**: "Insecure Deserialization" — ysoserial gadget references
- **File upload bypass**: "Upload Insecure Files" — extension/MIME bypass techniques
- **LFI → RCE**: "File Inclusion" — log poisoning, php://filter, zip://, expect://
- **XSS (for chaining)**: "XSS Injection" — CSP bypass, XSS in exotic contexts
- **XXE**: "XXE Injection" — OOB, parameter entities, blind XXE
- **JWT**: "JSON Web Token" — alg:none, confusion attacks, kid injection
- **SSRF bypass**: "Server Side Request Forgery" — cloud metadata, filter bypass
- **Prototype pollution**: "Prototype Pollution" — RCE gadget chains
- **Request smuggling**: "Request Smuggling" — CL.TE, TE.CL payloads

### Examples
- \`{ operation: "list" }\`
- \`{ operation: "get", category: "Server Side Template Injection" }\`
- \`{ operation: "get", category: "Command Injection" }\`
- \`{ operation: "search", query: "log poisoning" }\`
- \`{ operation: "search", query: "ysoserial CommonsCollections" }\`
- \`{ operation: "search", query: "INTO OUTFILE webshell" }\`
`
