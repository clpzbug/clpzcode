import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { PermissionRequestProps } from '../../components/permissions/PermissionRequest.js'

/**
 * Permission request UI for WorkflowTool — shown when Claude requests to
 * spawn a Dynamic Workflow fleet.
 */
export function WorkflowPermissionRequest({
  toolUseConfirm,
}: PermissionRequestProps) {
  const input = toolUseConfirm.input as {
    description?: string
    subtasks?: string[]
  }
  const { description, subtasks = [] } = input

  return (
    <Box flexDirection="column" gap={0}>
      <Box justifyContent="flex-end">
        <Text dimColor>Dynamic workflow requested</Text>
      </Box>
      <Box justifyContent="flex-end">
        <Text color="ansi:cyan">ultracode ×{subtasks.length}</Text>
      </Box>
      {description ? (
        <Box marginTop={1}>
          <Text>{description}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
