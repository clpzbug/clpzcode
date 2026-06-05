import { OAUTH_TOOL_NAME } from './constants.js'

export const PROMPT = `## ${OAUTH_TOOL_NAME} — OAuth/OIDC Security Testing

### ESCALATION RULE — OAuth vulnerabilities chain to account takeover:
1. action=redirect_uri — if redirect_uri bypass succeeds (CRITICAL), craft a page that starts OAuth, steals the ?code= parameter by redirecting to attacker-controlled domain
2. action=state_bypass — if no CSRF protection, use CSRF to force a victim to authorize your client → you receive the code/token
3. action=pkce_check — if PKCE downgrade to "plain" accepted, any party who intercepts the authorization code can replay it (native app scenarios)
4. Confirmed redirect_uri bypass → call ChainTool bug_class=open-redirect for the account-takeover exploitation technique

### Actions
- \`token_leak\` — request response_type=token and check if access_token leaks in the redirect URL/fragment
- \`state_bypass\` — verify CSRF protection: is authorization accepted with a missing or empty state parameter?
- \`redirect_uri\` — test redirect_uri for open redirect / allow-list bypass (path traversal, @-confusion)
- \`implicit_flow\` — detect insecure implicit flow (response_type=token accepted, tokens in URL fragment)
- \`pkce_check\` — PKCE not enforced (code flow accepted without code_challenge) AND PKCE downgrade (code_challenge_method=plain accepted, defeating S256)
- \`token_reuse\` — replay a fake authorization code at the token endpoint (requires token_url)

### Input
- \`authorization_url\`: OAuth authorization endpoint URL
- \`action\`: test to perform
- \`token_url\`: token endpoint URL (for token_reuse)
- \`client_id\`: OAuth client_id (default: test_client)
- \`redirect_uri\`: redirect URI to test (default: https://attacker.com/callback)
- \`scope\`: OAuth scopes (default: openid profile email)
- \`timeout_secs\`: request timeout (default: 30)

### Scope escalation testing (use extra_params)
- Test privilege escalation via scope: add extra_params={"scope":"admin openid"} or scope=offline_access
- Some providers accept scope parameters that grant additional privileges
- Test: action=token_leak with extra_params={"scope":"admin"} to check if elevated scope is granted

### Examples
- \`{ authorization_url: "https://provider.com/oauth/authorize", action: "redirect_uri", redirect_uri: "https://legit.com/cb" }\`
- \`{ authorization_url: "https://provider.com/oauth/authorize", action: "state_bypass" }\`
- \`{ authorization_url: "https://provider.com/oauth/authorize", action: "pkce_check" }\`
- \`{ authorization_url: "https://provider.com/oauth/authorize", token_url: "https://provider.com/oauth/token", action: "token_reuse" }\`
- Scope escalation: \`{ authorization_url: "https://provider.com/authorize", action: "token_leak", extra_params: {"scope": "admin openid profile"} }\`
`
