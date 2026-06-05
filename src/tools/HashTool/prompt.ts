import { HASH_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Hash identification and cracking using hashid, john, and hashcat.`

export const PROMPT = `## ${HASH_TOOL_NAME} — Hash identification and cracking

### ESCALATION RULE — After cracking any hash:
1. Windows NTLM/AD hash: crack → use with evil-winrm or pass-the-hash (PTH) for lateral movement
2. Linux /etc/shadow hash: crack → SSH as that user or sudo
3. Application password hash: crack → test on login page + other services (password reuse)
4. JWT secret: crack mode 16500 → JWTTool action=forge with the secret → admin access

### Common pentest hash types (hashcat modes):
- NTLM: 1000 (from secretsdump, Mimikatz, hashdump)
- NTLMv2: 5600 (from Responder/Inveigh)
- Kerberoast TGS: 13100 (from GetUserSPNs.py)
- AS-REP roast: 18200 (from GetNPUsers.py)
- MD5 web app: 0
- SHA1: 100 | SHA256: 1400 | SHA512: 1700
- bcrypt: 3200 (slow — use john)
- SHA512(Unix/Linux shadow): 1800 | SHA256(Unix): 7400 | MD5(Unix): 500
- JWT HS256: 16500

### Operations
- \`identify\` — detect hash type from hash string (uses hashid with hashcat mode numbers)
- \`crack_john\` — crack hash with John the Ripper (better for bcrypt/complex formats)
- \`crack_hashcat\` — crack hash with hashcat (GPU-accelerated, preferred for speed)

### Input for cracking
- \`hash\`: the hash string to crack
- \`hash_type\`: hashcat mode (see table above)
- \`wordlist\`: wordlist shortcut or absolute path
- \`rules\`: optional rule file (e.g. \`best64\`, \`OneRuleToRuleThemAll\`)
- \`extra_args\`: additional raw arguments

### Wordlist shortcuts
- \`rockyou\` → rockyou.txt.gz (14M passwords, start here)
- \`fast\` → top-1000 passwords (quick spray test first)
- \`ntlm\` → top-1M passwords (alias for AD hash cracking)
- \`common-pass\` → top-1M passwords

### Examples
- \`{ operation: "identify", hash: "aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c" }\`
- NTLM: \`{ operation: "crack_hashcat", hash: "8846f7eaee8fb117ad06bdd830b7586c", hash_type: "1000", wordlist: "fast" }\`
- Kerberoast: \`{ operation: "crack_hashcat", hash: "$krb5tgs$23$...", hash_type: "13100", wordlist: "rockyou" }\`
- Shadow: \`{ operation: "crack_john", hash: "$6$salt$hash...", wordlist: "rockyou" }\`
`
