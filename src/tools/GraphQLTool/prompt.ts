import { GRAPHQL_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `GraphQL security tester — introspection enumeration, injection detection, batch attacks, field suggestion abuse, and APQ (persisted query) detection.`

export const PROMPT = `## ${GRAPHQL_TOOL_NAME} — GraphQL Security Testing

### ESCALATION RULE — GraphQL attack order:
1. action=introspect — if schema returned: look for sensitive mutations (createUser, updatePassword, deleteAccount, adminMutation) and query fields with ID params (user(id:), order(id:))
2. action=batch — if true: batch brute-force login/OTP mutations (e.g. 100 attempts in 1 HTTP request)
3. action=suggest — find hidden fields via typo errors ("Did you mean X?") — may reveal admin/internal fields
4. action=inject on ID fields from introspect — test for SQLi in resolvers
5. For any mutation accepting file upload or URL input → test for SSRF or file-upload RCE
6. Confirmed IDOR via GraphQL: call ChainTool bug_class=idor-read

### Actions
- \`introspect\` — dump the full schema via introspection query
- \`batch\` — test for batch query abuse (array of queries in one request)
- \`inject\` — test for injection vulnerabilities in resolver arguments
- \`suggest\` — enumerate hidden fields via field suggestion error messages
- \`dos\` — test for nested query DoS (alias batching, deep nesting)
- \`info\` — extract server info (engine type, version from errors)
- \`persisted\` — detect Apollo Automatic Persisted Queries (APQ) via the persistedQuery extension

### Input
- \`url\`: GraphQL endpoint URL
- \`action\`: test action
- \`headers\`: optional auth headers (e.g. Authorization: Bearer token)
- \`query\`: custom GraphQL query for inject action
- \`field\`: field name to test (for suggest/inject)
- \`timeout_secs\`: timeout in seconds (default: 30)

### Examples
- \`{ url: "https://target.com/graphql", action: "introspect" }\`
- \`{ url: "https://target.com/graphql", action: "batch" }\`
- \`{ url: "https://target.com/graphql", action: "suggest", field: "user" }\`
- \`{ url: "https://target.com/graphql", action: "inject", query: "{ user(id: \\"1 OR 1=1\\") { id name } }" }\`
`
