import { CRYPTO_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Cryptographic operations: hashing, encoding, encryption, key generation via openssl.`

export const PROMPT = `## ${CRYPTO_TOOL_NAME} — Cryptographic operations

### Pentest use cases:
- Generate OOB markers: random_bytes count=16 → unique 32-char hex marker for injection confirmation
- Decode base64 credentials: decode_base64 data=<base64> (HTTP Basic auth, JWT payload, embedded secrets)
- Identify hash type: hash algorithm=md5/sha1/sha256 data=<string> → compare with target hash
- Verify file hash: hash algorithm=sha256 data_file=/path/to/file → integrity check

### Operations
- \`hash\` — compute hash of data (md5, sha1, sha256, sha512)
- \`encode_base64\` — base64 encode
- \`decode_base64\` — base64 decode (recover credentials from HTTP Basic auth, JWT payload)
- \`encode_hex\` — hex encode (for bypass encoding)
- \`decode_hex\` — hex decode
- \`encrypt_aes\` — AES-256-CBC encrypt (requires key hex OR password)
- \`decrypt_aes\` — AES-256-CBC decrypt
- \`gen_rsa_key\` — generate RSA key pair (bits: 2048 or 4096)
- \`gen_self_signed_cert\` — generate self-signed X.509 cert (requires key PEM)
- \`parse_cert\` — parse and display certificate info (verify expiry, CN, SANs)
- \`random_bytes\` — generate N random bytes (hex output) — use for unique OOB markers

### Input
- \`operation\`: operation name (required)
- \`data\`: input data as string
- \`data_file\`: absolute path to input file (alternative to data)
- \`algorithm\`: hash algo or cipher (md5/sha1/sha256/sha512, aes-256-cbc)
- \`key\`: encryption key (64 hex chars for AES-256) or RSA PEM
- \`password\`: passphrase for AES encrypt/decrypt (required if key not provided)
- \`iv\`: initialization vector (hex, 16 bytes for AES)
- \`bits\`: key size for gen_rsa_key (default: 2048)
- \`count\`: byte count for random_bytes (default: 32)

### Examples
- OOB marker: \`{ operation: "random_bytes", count: 16 }\` → 32-char unique hex for injection confirmation
- Decode HTTP Basic: \`{ operation: "decode_base64", data: "dXNlcjpwYXNz" }\` → user:pass
- SHA256 hash: \`{ operation: "hash", algorithm: "sha256", data: "hello world" }\`
- Verify hash: \`{ operation: "hash", algorithm: "md5", data_file: "/tmp/download.zip" }\`
`
