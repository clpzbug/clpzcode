import type { Command } from '../../commands.js'

const weakpoints = {
  type: 'local',
  name: 'weakpoints',
  description:
    'Summarize recurring local weak points (crashes, errors, React faults) recorded across sessions',
  isHidden: false,
  supportsNonInteractive: true,
  load: () => import('./weakpoints.js'),
} satisfies Command

export default weakpoints
