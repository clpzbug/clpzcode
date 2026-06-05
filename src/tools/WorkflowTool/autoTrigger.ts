// src/tools/WorkflowTool/autoTrigger.ts
//
// Auto-trigger heuristic (Task #11, §3). A pure, zero-cost scorer that decides
// whether a user prompt looks like it should run as a multi-agent workflow
// (parallel/pipelined work across many targets) rather than a single turn. Used
// on UserPromptSubmit: 'suggest' shows a non-blocking chip; 'auto' permits a
// direct WorkflowTool call (still behind the permission gate + cost ceiling).
//
// Conservative by design — false positives are annoying, so the threshold favors
// clearly-decomposable asks. No model call, no I/O: pure text analysis.

export type WorkflowSuggestion = {
  score: number
  /** Human-readable reasons (shown in the suggest chip / logged). */
  reasons: string[]
  /** score >= THRESHOLD. */
  suggest: boolean
}

export const SUGGEST_THRESHOLD = 3

// Phrases that strongly imply fan-out across many items.
const FANOUT_PHRASES = [
  /\bfor each\b/i,
  /\bfor every\b/i,
  /\bacross (the|all|every|multiple)\b/i,
  /\b(all|every) (the )?(files?|tests?|components?|modules?|endpoints?|packages?|services?)\b/i,
  /\bmigrate\b/i,
  /\brefactor\b.*\b(everywhere|across|all)\b/i,
  /\badd tests? (for|to) (all|every|each)\b/i,
  /\baudit\b/i,
  /\bin parallel\b/i,
  /\bone by one\b/i,
]

// Common imperative verbs (a task with several distinct verbs tends to decompose).
const IMPERATIVE_VERBS =
  /\b(add|fix|refactor|migrate|implement|write|test|audit|review|update|remove|rename|optimize|document|build|create|convert|port|verify|investigate|analyze)\b/gi

function countMatches(re: RegExp, text: string): number {
  const m = text.match(re)
  return m ? m.length : 0
}

/** Detect an enumerated list: numbered (1. / 1)) or bulleted (-, *, •) lines,
 *  or a comma/and-joined run of ≥3 clauses on one line. */
function enumeratedItemCount(prompt: string): number {
  const lines = prompt.split('\n')
  const listLines = lines.filter(l => /^\s*(\d+[.)]|[-*•])\s+\S/.test(l))
  if (listLines.length >= 2) return listLines.length
  // Single-line "a, b, c and d" style.
  const firstLong = lines.find(l => l.length > 0) ?? ''
  const commaParts = firstLong.split(/,|\band\b/).filter(p => p.trim().length > 2)
  return commaParts.length >= 3 ? commaParts.length : 0
}

/** Count distinct file-ish targets (paths / globs / dotted filenames). */
function fileTargetCount(prompt: string): number {
  const matches = prompt.match(/[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|md|json|css|html)\b|\*\*?\/\S+/gi)
  return matches ? new Set(matches.map(m => m.toLowerCase())).size : 0
}

export function scoreWorkflowPrompt(prompt: string): WorkflowSuggestion {
  const reasons: string[] = []
  let score = 0

  // Count distinct fan-out phrases: the first is strong (+2), each additional
  // reinforces (+1), capped at +4 so a single sentence can't run away.
  const fanout = FANOUT_PHRASES.filter(re => re.test(prompt)).length
  if (fanout > 0) {
    score += Math.min(2 + (fanout - 1), 4)
    reasons.push(`${fanout} fan-out phrase(s)`)
  }

  const items = enumeratedItemCount(prompt)
  if (items >= 3) {
    score += 2
    reasons.push(`${items} enumerated items`)
  } else if (items === 2) {
    score += 1
    reasons.push('2 enumerated items')
  }

  const distinctVerbs = new Set(
    (prompt.match(IMPERATIVE_VERBS) ?? []).map(v => v.toLowerCase()),
  ).size
  if (distinctVerbs >= 3) {
    score += 1
    reasons.push(`${distinctVerbs} distinct imperative verbs`)
  }

  const files = fileTargetCount(prompt)
  if (files >= 3) {
    score += 2
    reasons.push(`${files} file targets`)
  } else if (files === 2) {
    score += 1
    reasons.push('2 file targets')
  }

  return { score, reasons, suggest: score >= SUGGEST_THRESHOLD }
}
