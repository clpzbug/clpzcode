import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Command } from '../../commands.js'

// Available classes — kept in sync with ChainTool's CHAIN_DB (29 total)
const KNOWN_CLASSES = [
  // Web / app
  'open-redirect', 'ssrf-blind', 'ssrf', 'stored-xss', 'reflected-xss',
  'idor-read', 'cors-wildcard', 'cors-credentialed', 'path-traversal',
  'sqli', 'ssti', 'file-upload', 'lfi', 'command-injection', 'deserialization',
  'jwt-weak-secret', 'graphql', 'wordpress', 'csrf', 'xxe',
  'subdomain-takeover', 'race-condition',
  // Active Directory
  'kerberoast', 'asreproast', 'adcs-esc1', 'ntlm-relay', 'coerce', 'bloodhound-path', 'zerologon',
]

const chain = {
  type: 'prompt',
  name: 'chain',
  description: 'Given a confirmed bug, find escalation vectors to chain for higher impact',
  argumentHint: '<bug-class> [<target-url>]',
  source: 'builtin',
  progressMessage: 'Analyzing chain vectors',
  async getPromptForCommand(args: string): Promise<ContentBlockParam[]> {
    const parts = args.trim().split(/\s+/)
    const bugClass = parts[0]?.toLowerCase() ?? ''
    const targetUrl = parts.slice(1).join(' ')

    if (!bugClass) {
      return [{ type: 'text', text: `Usage: /chain <bug-class> [<target-url>]\n\nKnown classes: ${KNOWN_CLASSES.join(', ')}\n\nExample: /chain ssrf https://target.com` }]
    }

    return [{ type: 'text', text: buildChainPrompt(bugClass, targetUrl) }]
  },
  contentLength: 0,
} satisfies Command

function buildChainPrompt(bugClass: string, targetUrl: string): string {
  const target = targetUrl ? ` on **${targetUrl}**` : ''
  return `You have a confirmed **${bugClass}**${target}. You have **20 minutes** to find a chaining vector that escalates its severity.

**Step 1**: Call ChainTool with bug_class="${bugClass}"${targetUrl ? ` target_url="${targetUrl}"` : ''} to retrieve escalation vectors, technique, and confirmation criteria.

**Step 2**: Execute the chain in order of severity (ChainTool returns vectors sorted highest-impact first). For each vector:
1. Test it using the exact technique from ChainTool output
2. Confirm or discard: document the outcome either way
3. If confirmed → report the full chain A→B with proof and stop
4. If not confirmed → move to the next vector

**Step 3**: Timer rule — if 20 minutes pass without a confirmed chain, stop. Report the original ${bugClass} as a standalone finding. Do not continue testing once time is up.

**Output format**:
- **Chain confirmed**: describe full exploit chain (bug A → exploitation → bug B) with evidence for each step
- **No chain found in 20 minutes**: report original ${bugClass} standalone with its evidence

## Confirmation bar (examples)
- oauth-code-theft: auth code appears at attacker-controlled URL
- cloud-metadata: IAM credentials retrieved from 169.254.169.254
- rce / command-injection: id/whoami output, or DNS callback with hostname in subdomain
- file-read: contents of /etc/passwd, .env, or private key retrieved
- idor-write: another user's object successfully modified under your session

Start with ChainTool now.`
}

export default chain
