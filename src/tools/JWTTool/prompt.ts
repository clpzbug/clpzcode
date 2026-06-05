import { JWT_TOOL_NAME } from './constants.js'

export const PROMPT = `## ${JWT_TOOL_NAME} — JWT Security Testing

Decode, forge, crack, and test algorithm confusion attacks on JSON Web Tokens.

### ESCALATION RULE — JWT attack order for maximum impact:
1. action=decode — examine header (alg, kid) and payload (role, sub, exp, admin). Look for:
   - alg:HS256 → crackable with HashTool
   - alg:RS256 → confusion attack possible
   - kid header → path traversal (kid: "../../dev/null") or SQLi (kid: "' UNION SELECT 'attacker_secret'-- -")
   - no exp → lives forever (always accepted, no expiry)
2. action=alg_none — generates 8 variants. If ANY accepted → forge admin claims immediately
3. action=crack — try rockyou fast first. If cracked → forge in one step
4. If RS256: obtain public key from /.well-known/jwks.json → action=alg_confusion with the PEM
5. action=forge — once signing method confirmed: set role=admin, is_admin=true, sub=1. Test ALL API endpoints

### Actions
- \`decode\` — decode JWT header + payload without signature verification (reveals claims, alg, exp)
- \`forge\` — create forged JWT with custom claims and weak/none signature
- \`crack\` — brute-force HS256 secret with wordlist (rockyou or custom)
- \`alg_none\` — strip signature, set alg:none — generates 8 case/dot variants
- \`alg_confusion\` — RSA→HMAC confusion: sign with public key as HMAC secret
- \`check_exp\` — check if token is expired, time to expiry, or has no expiry

### Input
- \`token\`: JWT string (eyJ... format)
- \`action\`: test action
- \`claims\`: JSON string for custom claims in forge (e.g. '{"role":"admin","sub":"0","is_admin":true}')
- \`secret\`: Known or target HMAC secret (for forge/crack)
- \`public_key\`: RSA public key PEM (for alg_confusion)
- \`wordlist\`: Wordlist path for crack (default: rockyou)
- \`timeout_secs\`: Timeout for crack (default: 60)

### Examples
- \`{ token: "eyJ...", action: "decode" }\`
- \`{ token: "eyJ...", action: "alg_none" }\`
- \`{ token: "eyJ...", action: "crack", wordlist: "/usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt.gz" }\`
- \`{ token: "eyJ...", action: "forge", claims: '{"role":"admin","sub":"1","is_admin":true}', secret: "cracked_secret" }\`
`
