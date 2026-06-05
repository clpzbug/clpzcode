import { CRED_HARVEST_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Credential discovery tool — searches filesystems for hardcoded passwords, API keys, tokens, private keys, and secrets.`

export const PROMPT = `## ${CRED_HARVEST_TOOL_NAME} — Credential & Secret Discovery

Searches a filesystem path for hardcoded credentials, API keys, tokens, private keys, and other secrets using regex patterns.

### ESCALATION RULE — Found credentials must be used immediately:
- **DB connection string** (mysql://user:pass@host) → SQLiTool dump_dbs or direct SQL client
- **AWS keys** (AKIA...) → NucleiTool profile=aws to enumerate exposed S3/EC2/Secrets Manager
- **SSH private key** → BruteForceTool service=ssh with the key for lateral movement
- **JWT_SECRET** → JWTTool action=forge to forge admin tokens for all API endpoints
- **GitHub/GitLab token** → search repos for more secrets (scan .env, config, CI files)
- **/etc/shadow hashes** → HashTool operation=crack_hashcat to get system user passwords
- **GCP service account JSON** → NucleiTool profile=gcp to enumerate GCS/GCE/GKE access

### POST-EXPLOITATION STRATEGY — run these in order after getting a shell:
1. \`{ path: "/var/www", action: "deep", depth: 8 }\` — app source code (DB passwords, API keys, JWT secrets)
2. \`{ path: "/home", action: "deep", depth: 6 }\` — user home dirs (.bash_history, .ssh/, .aws/, .config/)
3. \`{ path: "/root", action: "deep", depth: 5 }\` — root home (same as above but privileged)
4. \`{ path: "/etc", action: "scan" }\` — system config (/etc/passwd, /etc/shadow hashes, service passwords)
5. \`{ path: "/opt", action: "deep", depth: 8 }\` — third-party apps (Grafana, Jenkins, GitLab, etc.)

### Actions
- \`scan\` — quick scan using high-signal patterns (passwords, API keys, private keys, DB URLs)
- \`deep\` — thorough scan with ALL patterns (includes cloud tokens, CI/CD, SaaS API keys)

### Input
- \`path\`: Base directory to search (default: \`/\`)
- \`action\`: \`scan\` (quick) or \`deep\` (thorough)
- \`depth\`: Max directory depth (default: 5)
- \`extensions\`: Limit to specific file extensions (e.g. \`[".env", ".conf", ".yaml"]\`)
- \`patterns\`: Additional custom regex patterns
- \`timeout_secs\`: Timeout in seconds (default: 120)

### High-value paths to search specifically (post-exploitation)
- \`/var/www/html/.env\` or \`/var/www/html/wp-config.php\` — WordPress DB creds
- \`/home/*/.aws/credentials\` — AWS keys (often left by devs)
- \`/home/*/.ssh/id_rsa\` — SSH private keys for lateral movement
- \`/home/*/.bash_history\` — command history with plaintext passwords
- \`/etc/shadow\` — password hashes to crack offline with HashTool
- \`/opt/jenkins/secrets/master.key\` — Jenkins master key

### Severity classification
- **critical**: Private keys, AWS credentials, DB connection strings with passwords, JWT secrets
- **high**: Hardcoded passwords, GitHub tokens, Stripe keys, OAuth secrets
- **medium**: Generic API keys, bearer tokens, Redis URLs
- **low**: Potentially sensitive strings

### Examples
- Post-shell web app: \`{ path: "/var/www", action: "deep", depth: 8 }\`
- User credentials: \`{ path: "/home", action: "deep", depth: 6 }\`
- All .env files: \`{ path: "/", action: "scan", extensions: [".env"], depth: 10 }\`
- GCP service accounts: \`{ path: "/", action: "scan", extensions: [".json"], depth: 8 }\`
`
