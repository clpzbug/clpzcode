import type { Command } from '../../commands.js'

/**
 * Returns dynamic workflow commands loaded from disk (e.g. ~/.clpzcode/workflows/).
 * In the open build, this returns an empty array — workflow scripts are managed at
 * runtime via the WorkflowTool directly.
 */
export async function getWorkflowCommands(_cwd: string): Promise<Command[]> {
  return []
}
