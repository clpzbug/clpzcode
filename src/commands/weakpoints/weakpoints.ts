import type {
  LocalCommandCall,
  LocalCommandResult,
} from '../../types/command.js'
import { readWeakPoints } from '../../diagnostics/weakPoints.js'

export const call: LocalCommandCall = async (): Promise<LocalCommandResult> => {
  const weakPoints = await readWeakPoints()
  if (weakPoints.length === 0) {
    return { type: 'text', value: 'No weak points recorded.' }
  }

  const groups = new Map<string, number>()
  for (const w of weakPoints) {
    const key = `${w.kind} / ${w.source}`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  const byGroup = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `  ${String(n).padStart(4)}  ${key}`)
    .join('\n')

  const recent = weakPoints
    .slice(-10)
    .reverse()
    .map(
      w =>
        `  ${new Date(w.ts).toISOString()}  [${w.kind}/${w.source}] ${w.name}: ${w.message.slice(0, 120)}`,
    )
    .join('\n')

  return {
    type: 'text',
    value: `Weak points (${weakPoints.length} total)\n\nBy kind/source:\n${byGroup}\n\nMost recent:\n${recent}`,
  }
}
