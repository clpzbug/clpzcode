import type { ToolUseContext } from '../../Tool.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { setActiveGoal, getActiveGoal } from '../../constants/goalStore.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  const trimmed = args.trim()

  if (trimmed === 'clear') {
    setActiveGoal(undefined)
    // Signal completion — StatusLine will flash "done" for 2.5s then auto-clear.
    context.setAppState(prev => {
      if (!prev.currentGoal) return prev
      return { ...prev, goalCompletedAt: Date.now() }
    })
    onDone('Goal cleared.', { display: 'system' })
    return null
  }

  if (!trimmed) {
    const current = getActiveGoal()
    const msg = current
      ? `Current goal: ${current}\n\nUse /goal <description> to change or /goal clear to remove.`
      : 'No active goal. Use /goal <description> to set one.'
    onDone(msg, { display: 'system' })
    return null
  }

  setActiveGoal(trimmed)
  context.setAppState(prev => ({ ...prev, currentGoal: trimmed, goalSetAt: Date.now() }))
  onDone(trimmed, {
    display: 'user',
    shouldQuery: true,
  })
  return null
}
