import { FUZZ_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Web fuzzer using ffuf with SecLists auto-resolve. Returns structured hit results.`

export const PROMPT = `## ${FUZZ_TOOL_NAME} — Web directory/parameter fuzzing with ffuf

Runs ffuf and returns structured JSON results. The URL must contain the FUZZ keyword.

### ESCALATION RULE — Fuzzing finds doors; you must open them:
1. Found /admin, /console, /phpmyadmin → BruteForceTool http-post-form to gain access
2. Found upload endpoint (upload, file, avatar, import) → test for webshell via file-upload chain
3. Found /api/ paths → ReconTool action=classify_endpoints → then targeted injection tests
4. SSTI hit (wordlist=ssti, response length differs) → immediately use SSTITool for RCE
5. LFI confirmed → ChainTool bug_class=lfi for full chain (log poisoning, PHP wrapper RCE)
6. Found /backup, /.git, /phpinfo.php → FuzzTool extensions=[".sql",".zip",".tar.gz"] then fetch

### Wordlist shortcuts (auto-resolved to SecLists paths)

**Directory / file discovery:**
- \`common\` → Discovery/Web-Content/common.txt (~4,700 entries)
- \`big\` → Discovery/Web-Content/big.txt (~20,000 entries)
- \`medium\` → Discovery/Web-Content/directory-list-2.3-medium.txt (~220,000 entries)
- \`small\` → Discovery/Web-Content/directory-list-2.3-small.txt (~87,000 entries)
- \`raft\` → raft-large-files.txt (real-world files, lowercase)
- \`raft-dirs\` → raft-large-directories.txt (real-world dirs, lowercase)

**API / parameter discovery:**
- \`api\` → Discovery/Web-Content/api/objects.txt
- \`params\` → Discovery/Web-Content/burp-parameter-names.txt

**DNS:**
- \`subdomains\` → DNS/subdomains-top1million-5000.txt
- \`vhosts\` → DNS/namelist.txt

**Security-specific (inject directly as FUZZ value):**
- \`lfi\` → Fuzzing/LFI/LFI-Jhaddix.txt — path traversal payloads for LFI testing
- \`backups\` → Discovery/Web-Content/Common-DB-Backups.txt — database backup files
- \`command-injection\` → Fuzzing/command-injection-commix.txt — OS command injection payloads
- \`xss-poly\` → Fuzzing/XSS/robot-friendly/XSS-BruteLogic.txt — XSS polyglots (for confirming XSS contexts)
- \`ssti\` → Fuzzing/template-engines-expression.txt — template engine expressions for SSTI detection
- \`ssti-vars\` → Fuzzing/template-engines-special-vars.txt — special variables for engine fingerprinting
- \`sqli-blind\` → Fuzzing/Databases/MySQL-Read-Local-Files.fuzzdb.txt — MySQL file read payloads

**API / GraphQL discovery:**
- \`graphql\` → Discovery/Web-Content/graphql.txt — GraphQL endpoint names
- \`api-endpoints\` → Discovery/Web-Content/common-api-endpoints-mazen160.txt — common API endpoints
- \`api-wild\` → Discovery/Web-Content/api/api-seen-in-wild.txt — API paths seen in real apps
- \`url-params\` → url-params_from-top-55-most-popular-apps.txt — hidden parameter discovery

**Targeted discovery:**
- \`secrets\` → quickhits.txt (2567 entries) — .env, .git/, .htpasswd, wp-config.php, backup.sql, .DS_Store
- \`spring-actuator\` → curated list (50 entries) — /actuator/env, /actuator/heapdump, /actuator/shutdown, /h2-console, Swagger UI
- \`wordpress\` → CMS/wordpress.fuzz.txt — WP plugins, themes, xmlrpc, wp-json

- Or pass any absolute path directly.

### LFI testing example
- \`{ url: "http://target/page.php?file=FUZZ", wordlist: "lfi", filter_status: [500] }\`
- Look for responses longer than baseline (file read succeeded)

### SSTI pre-scan example (find which params evaluate template expressions)
- \`{ url: "http://target/search?q=FUZZ", wordlist: "ssti" }\`
- Any response where length differs from baseline may be SSTI (e.g. "49" reflected instead of "{{7*7}}")

### Filtering
- \`filter_status\`: exclude these HTTP status codes (default: ["404"])
- \`filter_size\`: exclude responses of exactly these byte sizes
- \`match_status\`: only include these HTTP status codes

### Examples
- Dir scan: \`{ url: "http://target/FUZZ", wordlist: "common" }\`
- Extension scan: \`{ url: "http://target/FUZZ", wordlist: "common", extensions: [".php",".html",".bak",".conf"] }\`
- Param fuzz: \`{ url: "http://target/page?FUZZ=1", wordlist: "params" }\`
- LFI test: \`{ url: "http://target/page?file=FUZZ", wordlist: "lfi" }\`
- Backup files: \`{ url: "http://target/FUZZ", wordlist: "backups" }\`
- Status filter: \`{ url: "http://target/FUZZ", wordlist: "big", match_status: [200, 301] }\`
`
