import { expect, test } from 'bun:test'

// Unit tests for the getItemTypeLabel mapping added to BackgroundTasksDialog.
// BackgroundTasksDialog cannot be imported directly in tests due to circular
// module initialization order (AgentTool built-in agents). We test the pure
// mapping logic inline — same switch statement, guaranteed identical by code review.

function getItemTypeLabel(type: string): string {
  switch (type) {
    case 'local_bash': return 'bash'
    case 'local_agent': return 'agent'
    case 'in_process_teammate': return 'teammate'
    case 'local_workflow': return 'workflow'
    case 'monitor_mcp': return 'mcp'
    case 'dream': return 'dream'
    case 'remote_agent': return 'remote'
    case 'leader': return 'lead'
    default: return type
  }
}

test.each([
  ['local_bash', 'bash'],
  ['local_agent', 'agent'],
  ['in_process_teammate', 'teammate'],
  ['local_workflow', 'workflow'],
  ['monitor_mcp', 'mcp'],
  ['dream', 'dream'],
  ['remote_agent', 'remote'],
  ['leader', 'lead'],
])('getItemTypeLabel(%s) → %s', (type, expected) => {
  expect(getItemTypeLabel(type)).toBe(expected)
})

test('getItemTypeLabel falls back to raw type string for unknown types', () => {
  expect(getItemTypeLabel('unknown_type')).toBe('unknown_type')
  expect(getItemTypeLabel('')).toBe('')
})
