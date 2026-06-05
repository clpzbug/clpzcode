import { CACHE_POISONING_TOOL_NAME } from './constants.js'

export const PROMPT = `## ${CACHE_POISONING_TOOL_NAME} — Web Cache Poisoning & Deception

Test for web cache poisoning (injecting malicious content into shared caches) and web cache deception (tricking users into caching sensitive responses).

### ESCALATION RULE — Cache poisoning escalates quickly:
1. action=poison_headers first — if X-Forwarded-Host value reflects in response AND the response is cached (Age header > 0, or second request returns same body) → CONFIRMED
2. Confirmed cache poisoning: inject JavaScript (e.g. poison_value='evil.com"><script>alert(1)</script>) to achieve stored XSS via cache for all users
3. If reflected host is used in redirect: inject malicious redirect URL → account takeover via OAuth redirect_uri
4. action=cache_deception: if authenticated response is cached at /account/profile.css → access another user's session by requesting that path
5. Confirmed findings → call ChainTool bug_class=stored-xss or bug_class=open-redirect for next escalation

### Actions
- \`poison_headers\` — inject unkeyed headers (X-Forwarded-Host, X-Host, etc.) and check if value is reflected
- \`cache_deception\` — test path confusion to cache authenticated responses (e.g. /account/secret.css)
- \`key_audit\` — probe which request components are cache-keyed (vary headers, query params, path, fat GET body, parameter cloaking via duplicate/semicolon-delimited params)
- \`dos\` — test for error/large-response being cached (cache-layer DoS candidate)

### Input
- \`url\`: target URL to test
- \`action\`: test action
- \`headers\`: extra request headers (e.g. session cookie, auth token)
- \`poison_value\`: value to inject as unkeyed host header (default: attacker.example.com)
- \`path_suffix\`: suffix for cache deception test (default: .css)
- \`timeout_secs\`: per-request timeout in seconds (default: 30)

### Unkeyed headers tested by default
X-Forwarded-Host, X-Host, X-Forwarded-Server, X-Original-URL, X-Rewrite-URL, X-Forwarded-Scheme, CF-Connecting-IP, True-Client-IP, Forwarded

### Examples
- \`{ url: "https://target.com/", action: "poison_headers", poison_value: "attacker.example.com" }\`
- \`{ url: "https://target.com/account/profile", action: "cache_deception" }\`
- \`{ url: "https://target.com/page", action: "key_audit" }\`
`
