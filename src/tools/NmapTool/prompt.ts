import { NMAP_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Network scanner using nmap. Returns structured host/port/service/OS/script data.`

export const PROMPT = `## ${NMAP_TOOL_NAME} — Network scanning and service detection

Runs nmap and returns structured results (not raw text). Use this instead of calling nmap via Bash.

### Post-scan escalation — based on open ports:
- 22/SSH open → BruteForceTool service=ssh (if no key auth) or banner version → CVE check
- 80/443/8080 web → SpiderTool to map attack surface → ReconTool classify_endpoints
- 3306/5432 DB exposed → BruteForceTool service=mysql/postgres with top100 passwords
- 6379 Redis exposed → NetTool send PING → if PONG: no auth → data dump / RCE via eval
- 9200 Elasticsearch → NetTool banner_grab → GET /_cat/indices → data exfil
- 2375 Docker daemon → NetTool check_open → if open: full host RCE via container spawn
- 6443 Kubernetes → probe API with SA token if available
- 445/SMB open → NmapTool scripts=["smb-vuln-ms17-010","smb-vuln-cve-2020-0796"] → EternalBlue/SMBGhost
- 8500/Consul → NetTool GET /v1/kv/?recurse → secrets in KV store; /v1/catalog/services for attack surface
- 11211/Memcached → NetTool send "stats\r\n" → version/items; "get <key>\r\n" for cached data dump
- 27017/MongoDB → NetTool banner_grab → if "MongoDB" in banner with no auth prompt → data dump
- 5000/5432 exposed + version → NucleiTool profile=cves with dbms-specific CVE tag for known exploits
- 8080/8443/3000/5000/9090 web alt-ports → same as 80/443 — SpiderTool + ReconTool + NucleiTool

### scan_type presets
- \`quick\` — top 1000 ports, version light (-sV --version-light)
- \`service\` — version + default scripts (-sV -sC)
- \`full\` — all 65535 ports (-p- -sV)
- \`vuln\` — vulnerability scripts (--script vuln)
- \`scripts\` — named NSE scripts (requires \`scripts\` param)
- \`aggressive\` — OS + version + traceroute + default scripts (-A)
- \`udp\` — top 200 UDP ports (-sU --top-ports 200)
- \`stealth\` — SYN scan at T2 (-sS -T2), low IDS profile
- \`ping_sweep\` — host discovery only, no port scan (-sn)
- \`os_detect\` — OS fingerprinting (-O --osscan-guess)
- \`script_cat\` — NSE categories (requires \`script_categories\` param)
- \`custom\` — pass raw \`extra_args\`

### Additive flags (combine with any scan_type)
- \`no_ping: true\` — -Pn: skip host discovery (use for firewalled hosts)
- \`os_detect: true\` — add -O to any scan type
- \`traceroute: true\` — add --traceroute
- \`min_rate: N\` — --min-rate N packets/second (speed up slow scans)
- \`max_retries: N\` — --max-retries N
- \`script_categories: ["auth","brute","exploit"]\` — add NSE categories on top
- \`script_args: {"key":"val"}\` — --script-args

### NSE script categories
auth, brute, default, discovery, dos, exploit, external, fuzzer, intrusive, malware, safe, version, vuln

### timing
0 (paranoid) → 5 (insane). Default: 4. Use 3 or 2 for stealth.

### Output
Returns structured hosts with: ip, hostname, mac_address, status, os_guess (with confidence %), traceroute hops, ports (number, protocol, state, service, version, cpe, reason, scripts).

### Examples
- Quick scan: \`{ targets: ["192.168.1.1"], scan_type: "quick" }\`
- Aggressive: \`{ targets: ["10.0.0.1"], scan_type: "aggressive" }\`
- Firewalled host: \`{ targets: ["10.0.0.1"], scan_type: "service", no_ping: true }\`
- UDP scan: \`{ targets: ["10.0.0.1"], scan_type: "udp" }\`
- OS detection: \`{ targets: ["10.0.0.1"], scan_type: "os_detect" }\`
- Stealth + specific ports: \`{ targets: ["10.0.0.0/24"], scan_type: "stealth", ports: "22,80,443,8080" }\`
- Auth + brute scripts: \`{ targets: ["10.0.0.1"], scan_type: "script_cat", script_categories: ["auth","brute"] }\`
- SMB with script args: \`{ targets: ["10.0.0.1"], scan_type: "scripts", scripts: ["smb-enum-shares"], script_args: {"smbdomain":"CORP","smbusername":"admin"} }\`
- Subnet sweep: \`{ targets: ["192.168.1.0/24"], scan_type: "ping_sweep" }\`
- Full + OS + min-rate: \`{ targets: ["10.0.0.1"], scan_type: "full", os_detect: true, min_rate: 1000 }\`
`
