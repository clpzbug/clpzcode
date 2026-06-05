import { PACKET_CAPTURE_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Network packet capture and analysis using tshark. Capture live traffic or parse pcap files.`

export const PROMPT = `## ${PACKET_CAPTURE_TOOL_NAME} — Packet capture and analysis with tshark

### ESCALATION RULE — Captured traffic must be weaponized:
- **NTLMv2 hash in SMB capture**: save to file → HashTool operation=crack_hashcat hash_type=5600 (NTLMv2) + rockyou → if cracked → BruteForceTool spray on SMB/SSH
- **Kerberos TGS in capture**: export ticket → HashTool hash_type=13100 (Kerberoast) → crack offline → ADAttackTool
- **HTTP Authorization: Basic** in capture: base64 decode in-place (echo -n "..." | base64 -d) → test on all services
- **Cleartext password** in FTP/Telnet/HTTP: use BruteForceTool to spray across all services (SSH/SMB/RDP)
- **LDAP bind credentials**: spray across SMB, WinRM, and ADReconTool with captured creds

### Modes
- Live capture: specify \`interface\`, optionally \`count\` or \`duration_secs\`
- File analysis: specify \`pcap_file\` to analyze an existing capture

### Pentest use cases:
- Capture cleartext credentials: \`capture_filter: "tcp port 80 or tcp port 21 or tcp port 23 or tcp port 25 or tcp port 110"\`
- SMB hash capture (for offline cracking): \`capture_filter: "port 445"\` — combine with Responder for hash theft
- DNS enumeration (C2 detection, data exfil via DNS): \`display_filter: "dns"\`
- HTTP requests and responses: \`display_filter: "http"\` with fields=["http.host","http.request.uri","http.authorization"]
- ARP traffic (network mapping, ARP poisoning detection): \`capture_filter: "arp"\`
- Kerberos traffic (AS-REQ/TGS capture): \`display_filter: "kerberos"\`

### Input
- \`interface\`: network interface to capture on (e.g. "eth0", "lo", "any")
- \`pcap_file\`: path to existing .pcap/.pcapng file (alternative to live capture)
- \`capture_filter\`: BPF filter string (e.g. "tcp port 80", "host 10.0.0.1")
- \`display_filter\`: Wireshark display filter (e.g. "http", "dns", "tcp.flags.syn==1")
- \`count\`: max packets to capture (default: 100)
- \`duration_secs\`: max capture duration (default: 10, max: 60)
- \`fields\`: specific fields to extract (e.g. ["ip.src","ip.dst","tcp.dstport"])
- \`summary_only\`: return protocol statistics instead of packet list

### Common capture filters
- "tcp port 80" — HTTP traffic
- "port 53" — DNS
- "icmp" — ping traffic
- "host 10.0.0.1" — traffic to/from specific host
- "port 445" — SMB (hash capture + lateral movement)
- "port 389 or port 636" — LDAP/LDAPS (AD queries)

### Useful field extractions
- HTTP: ["ip.src","ip.dst","http.host","http.request.uri","http.authorization"]
- DNS: ["ip.src","dns.qry.name","dns.resp.addr"]
- SMB: ["ip.src","ip.dst","smb2.filename","ntlmssp.auth.username"]

### Examples
- \`{ interface: "eth0", count: 50, display_filter: "http" }\`
- \`{ pcap_file: "/tmp/capture.pcap", display_filter: "dns" }\`
- \`{ interface: "any", capture_filter: "port 443", duration_secs: 5 }\`
- \`{ interface: "eth0", capture_filter: "port 80", fields: ["ip.src","http.host","http.authorization"], count: 200 }\`
`
