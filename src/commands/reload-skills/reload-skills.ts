import type { LocalCommandCall } from '../../types/command.js'
import { clearCommandMemoizationCaches } from '../../commands.js'
import { clearSkillCaches } from '../../skills/loadSkillsDir.js'

export const call: LocalCommandCall = async (_args, _context) => {
  clearSkillCaches()
  clearCommandMemoizationCaches()
  return { type: 'text', value: 'Skills reloaded from disk.' }
}
