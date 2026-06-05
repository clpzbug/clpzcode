import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import React from 'react'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { AppStateProvider } from '../state/AppState.js'
import { renderToString } from '../utils/staticRender.js'

let TaskListV2: React.ComponentType<{ tasks: Task[] }>

beforeEach(async () => {
  await acquireSharedMutationLock('components/TaskListV2.test.tsx')

  mock.module('../hooks/useTerminalSize.js', () => ({
    useTerminalSize: () => ({ rows: 24, columns: 120 }),
  }))

  mock.module('../utils/tasks.js', () => ({
    isTodoV2Enabled: () => true,
  }))

  mock.module('../utils/agentSwarmsEnabled.js', () => ({
    isAgentSwarmsEnabled: () => false,
  }))

  const nonce = `${Date.now()}-${Math.random()}`
  ;({ TaskListV2 } = await import(`./TaskListV2.js?nonce=${nonce}`) as any)
})

afterEach(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

type Task = {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  owner?: string
  blocks: string[]
  blockedBy: string[]
}

function task(
  id: string,
  status: Task['status'],
  subject: string,
  extra: Partial<Task> = {},
): Task {
  return { id, status, subject, description: '', blocks: [], blockedBy: [], ...extra }
}

function render(tasks: Task[], columns = 120): Promise<string> {
  return renderToString(
    <AppStateProvider>
      <TaskListV2 tasks={tasks as any} />
    </AppStateProvider>,
    columns,
  )
}

test('pending task shows braille dot icon (⠂)', async () => {
  const output = await render([task('1', 'pending', 'Write tests')])
  expect(output).toContain('⠂')
  expect(output).toContain('Write tests')
})

test('in_progress task shows braille spinner frame (2×2)', async () => {
  const output = await render([task('2', 'in_progress', 'Running task')])
  expect(output).toMatch(/[⠂⠒⠐⠰⠠⠤⠄⠆]/)
  expect(output).toContain('Running task')
})

test('completed task shows braille 2x2 block (⠶)', async () => {
  const output = await render([task('3', 'completed', 'Done task')])
  expect(output).toContain('⠶')
  expect(output).toContain('Done task')
})

test('#id always appears regardless of terminal width', async () => {
  const tasks = [task('42', 'pending', 'Some task')]
  const narrow = await render(tasks, 40)
  const wide = await render(tasks, 200)
  expect(narrow).toContain('#42')
  expect(wide).toContain('#42')
})

test('all three statuses render distinct icons', async () => {
  const output = await render([
    task('1', 'pending', 'Task A'),
    task('2', 'in_progress', 'Task B'),
    task('3', 'completed', 'Task C'),
  ])
  expect(output).toContain('⠂')
  expect(output).toContain('⠶')
  expect(output).toMatch(/[⠂⠒⠐⠰⠠⠤⠄⠆]/)
})

test('blocked task shows blocker ids when blocker is unresolved', async () => {
  const output = await render([
    task('1', 'pending', 'Blocker task'),
    task('2', 'pending', 'Blocked task', { blockedBy: ['1'] }),
  ])
  expect(output).toContain('blocked by')
  expect(output).toContain('#1')
})

test('blocked by does not show when blocker is completed', async () => {
  const output = await render([
    task('1', 'completed', 'Blocker task'),
    task('2', 'pending', 'Blocked task', { blockedBy: ['1'] }),
  ])
  expect(output).not.toContain('blocked by')
})

test('returns null when tasks array is empty', async () => {
  const output = await render([])
  expect(output.trim()).toBe('')
})
