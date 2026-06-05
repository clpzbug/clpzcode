/**
 * /reload-skills — Reload skills from disk in the current session.
 * Clears the skill cache so new/modified skills are picked up immediately.
 */
import type { Command } from '../../commands.js'

const reloadSkills = {
  type: 'local',
  name: 'reload-skills',
  description: 'Reload skills from disk in the current session',
  supportsNonInteractive: false,
  load: () => import('./reload-skills.js'),
} satisfies Command

export default reloadSkills
