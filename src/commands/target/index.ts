import type { Command } from '../../commands.js'

const target = {
  type: 'local',
  name: 'target',
  description:
    'Show the natively-detected target project folder and where its memory is saved',
  isHidden: false,
  supportsNonInteractive: true,
  load: () => import('./target.js'),
} satisfies Command

export default target
