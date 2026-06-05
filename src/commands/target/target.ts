import { getTargetProjectInfo } from '../../memdir/paths.js'
import type {
  LocalCommandCall,
  LocalCommandResult,
} from '../../types/command.js'

export const call: LocalCommandCall = async (): Promise<LocalCommandResult> => {
  const t = getTargetProjectInfo()
  const lines = [
    `Target project:  ${t.dir}`,
    `Git root:        ${t.gitRoot ?? '(not a git repo — keyed off cwd)'}`,
    `Scope:           ${t.scope}`,
    `Memory dir:      ${t.memoryPath}`,
    `Auto-memory:     ${t.autoMemoryEnabled ? 'enabled' : 'disabled'}`,
  ]
  return { type: 'text', value: lines.join('\n') }
}
