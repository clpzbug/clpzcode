import type { Command } from '../../commands.js'

const goal = {
  type: 'local-jsx',
  name: 'goal',
  description: 'Set, view, or clear the active session goal',
  argumentHint: '<description> | clear',
  immediate: true,
  load: () => import('./goal.js'),
} satisfies Command

export default goal
