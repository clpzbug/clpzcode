import { BRUTE_FORCE_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Credential brute-forcing using hydra. Supports SSH, HTTP, FTP, SMB, RDP, WinRM, PostgreSQL, and more.`

export const PROMPT = `## ${BRUTE_FORCE_TOOL_NAME} — Credential brute-force with hydra

### ESCALATION RULE — Cracked credentials must be used, not just logged:
1. SSH cracked → run PrivEscTool action=all on the box (sudo -l, SUID, writable cron, polkit)
2. SMB cracked → ADAttackTool action=enum (enumerate shares, find sensitive files); if domain → bloodhound-path
3. HTTP/admin cracked → test for file upload, RCE, or config export behind authentication
4. DB cracked (mysql/postgres/mssql) → SQLiTool extra_args="--os-shell" for OS command execution
5. WinRM cracked → run CredHarvestTool path=/Users, PrivEscTool action=all via PowerShell
6. RDP cracked → run CredHarvestTool + ADReconTool if domain-joined

### Supported services
ssh, ftp, http-get, http-post-form, https-get, https-post-form, smb, telnet,
mysql, mssql, postgres, rdp, vnc, winrm, pop3, smtp, imap, ldap2, ldap3, redis, mongodb, snmp

### Pentest use cases:
- After Kerberoast/AS-REP crack → spray cracked password: service=smb or ssh, single password
- Discovered admin panel → brute HTTP: service=http-post-form with form data
- Found RDP exposed → brute admin: service=rdp, username=administrator
- WinRM available → brute for PowerShell access: service=winrm
- Database exposed → brute: service=postgres or mysql or mssql

### Input
- \`target\`: IP or hostname
- \`service\`: protocol (e.g. "ssh", "smb", "winrm")
- \`port\`: optional port number
- \`username\` / \`username_file\`: single user or file path
- \`password\` / \`password_file\`: single password or file path
- \`http_path\`: required for http-get/http-post-form (e.g. "/login")
- \`http_form_data\`: POST form string with ^USER^ and ^PASS^ tokens
- \`threads\`: parallelism (default: 4, max: 64)
- \`extra_args\`: raw hydra arguments appended at end

### Wordlist shortcuts
- \`top100\` → 10-million-password-list-top-100.txt (fastest spray)
- \`top1000\` → 10-million-password-list-top-1000.txt
- \`usernames\` → top-usernames-shortlist.txt
- \`rockyou\` → rockyou.txt.gz (for comprehensive brute)

### Examples
- Password spray after Kerberoast: \`{ target: "10.0.0.1", service: "smb", username_file: "usernames", password: "Summer2024!" }\`
- SSH brute: \`{ target: "10.0.0.1", service: "ssh", username: "admin", password_file: "top1000" }\`
- HTTP login: \`{ target: "10.0.0.1", service: "http-post-form", http_path: "/login", http_form_data: "user=^USER^&pass=^PASS^", http_success_string: "F:Invalid" }\`
- WinRM: \`{ target: "10.0.0.1", service: "winrm", username: "administrator", password_file: "top1000" }\`
`
