import type { Command } from '../../commands.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login xai',
    description: 'Sign in with your xAI account to use Grok models',
    load: () => import('./login-xai.js'),
  }) satisfies Command
