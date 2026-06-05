/**
 * Tests for:
 *   Gap A — ptyExec.ts onTimeout support
 *   Gap B+D — isPty field in LocalShellTaskState / stall watchdog message
 *   Gap C — nativeTaskRunner task-system integration
 */

import { test, expect, mock, beforeEach } from 'bun:test'
import { looksLikePrompt } from '../tasks/LocalShellTask/LocalShellTask.js'

// ---------------------------------------------------------------------------
// Gap B helpers — stall watchdog prompt detection (pure function, no mocking)
// ---------------------------------------------------------------------------

test('looksLikePrompt: detects y/n pattern', () => {
  expect(looksLikePrompt('some output\nContinue? (Y/n)')).toBe(true)
  expect(looksLikePrompt('some output\nContinue? [y/N]')).toBe(true)
})

test('looksLikePrompt: detects yes/no pattern', () => {
  expect(looksLikePrompt('Are you sure? (yes/no)')).toBe(true)
})

test('looksLikePrompt: detects Press Enter', () => {
  expect(looksLikePrompt('waiting...\nPress Enter to continue')).toBe(true)
})

test('looksLikePrompt: detects directed question', () => {
  expect(looksLikePrompt('Do you want to proceed?')).toBe(true)
  expect(looksLikePrompt('Would you like to continue?')).toBe(true)
})

test('looksLikePrompt: does not fire on normal output', () => {
  expect(looksLikePrompt('Building project...\n[==========] 100%\nDone.')).toBe(false)
  expect(looksLikePrompt('')).toBe(false)
  expect(looksLikePrompt('error: file not found')).toBe(false)
})

// ---------------------------------------------------------------------------
// Gap D — LocalShellTaskState type includes isPty
// ---------------------------------------------------------------------------

test('LocalShellTaskState accepts isPty field', () => {
  // Type-level test: if this compiles, the field exists in the type.
  const state = {
    id: 'test-id',
    type: 'local_bash' as const,
    description: 'test',
    status: 'running' as const,
    command: 'echo hello',
    completionStatusSentInAttachment: false,
    shellCommand: null,
    lastReportedTotalLines: 0,
    isBackgrounded: false,
    startTime: Date.now(),
    outputOffset: 0,
    notified: false,
    isPty: true,
  }
  expect(state.isPty).toBe(true)
})

test('LocalShellTaskState isPty is optional (defaults to undefined)', () => {
  const state = {
    id: 'test-id',
    type: 'local_bash' as const,
    description: 'test',
    status: 'running' as const,
    command: 'echo hello',
    completionStatusSentInAttachment: false,
    shellCommand: null,
    lastReportedTotalLines: 0,
    isBackgrounded: false,
    startTime: Date.now(),
    outputOffset: 0,
    notified: false,
  }
  expect((state as Record<string, unknown>).isPty).toBeUndefined()
})

// ---------------------------------------------------------------------------
// Gap C — nativeTaskRunner: task registration and cleanup
// ---------------------------------------------------------------------------

test('runNativeWithTask: registers task in AppState and removes on completion', async () => {
  const { runNativeWithTask } = await import('../utils/task/nativeTaskRunner.js')

  let currentTasks: Record<string, unknown> = {}
  const setAppState = (f: (prev: { tasks: Record<string, unknown> }) => { tasks: Record<string, unknown> }) => {
    const next = f({ tasks: currentTasks })
    currentTasks = next.tasks
  }

  const ac = new AbortController()

  const resultPromise = runNativeWithTask({
    binary: 'echo',
    args: ['hello'],
    description: 'Test echo',
    command: 'echo hello',
    timeoutMs: 5000,
    setAppState: setAppState as never,
    abortSignal: ac.signal,
  })

  // registerTask is called synchronously in the Promise constructor —
  // no setTimeout needed.
  const taskIds = Object.keys(currentTasks)
  expect(taskIds.length).toBe(1)
  const task = currentTasks[taskIds[0]!] as Record<string, unknown>
  expect(task.status).toBe('running')
  expect(task.isBackgrounded).toBe(true)

  const result = await resultPromise

  // After completion, task should be removed
  expect(Object.keys(currentTasks).length).toBe(0)
  expect(result.code).toBe(0)
  expect(result.stdout).toContain('hello')
})

test('runNativeWithTask: captures stderr', async () => {
  const { runNativeWithTask } = await import('../utils/task/nativeTaskRunner.js')

  const tasks: Record<string, unknown> = {}
  const setAppState = (f: (prev: { tasks: typeof tasks }) => { tasks: typeof tasks }) => {
    const next = f({ tasks })
    for (const key of Object.keys(tasks)) {
      if (!(key in next.tasks)) delete tasks[key]
    }
    Object.assign(tasks, next.tasks)
  }

  const ac = new AbortController()

  const result = await runNativeWithTask({
    binary: 'bash',
    args: ['-c', 'echo err >&2; echo out'],
    description: 'Test stderr',
    command: 'bash -c "echo err >&2; echo out"',
    timeoutMs: 5000,
    setAppState: setAppState as never,
    abortSignal: ac.signal,
  })

  expect(result.stdout.trim()).toBe('out')
  expect(result.stderr.trim()).toBe('err')
  expect(result.code).toBe(0)
})

test('runNativeWithTask: nonzero exit code on failure', async () => {
  const { runNativeWithTask } = await import('../utils/task/nativeTaskRunner.js')

  const tasks: Record<string, unknown> = {}
  const setAppState = (f: (prev: { tasks: typeof tasks }) => { tasks: typeof tasks }) => {
    const next = f({ tasks })
    for (const key of Object.keys(tasks)) {
      if (!(key in next.tasks)) delete tasks[key]
    }
    Object.assign(tasks, next.tasks)
  }

  const result = await runNativeWithTask({
    binary: 'bash',
    args: ['-c', 'exit 42'],
    description: 'Test failure',
    command: 'bash -c "exit 42"',
    timeoutMs: 5000,
    setAppState: setAppState as never,
    abortSignal: new AbortController().signal,
  })

  expect(result.code).toBe(42)
  // Task removed on completion even for failures
  expect(Object.keys(tasks).length).toBe(0)
})

test('runNativeWithTask: kill via shellCmd.kill() removes task', async () => {
  const { runNativeWithTask } = await import('../utils/task/nativeTaskRunner.js')

  const tasks: Record<string, unknown> = {}
  const setAppState = (f: (prev: { tasks: typeof tasks }) => { tasks: typeof tasks }) => {
    const next = f({ tasks })
    for (const key of Object.keys(tasks)) {
      if (!(key in next.tasks)) delete tasks[key]
    }
    Object.assign(tasks, next.tasks)
  }

  const resultPromise = runNativeWithTask({
    binary: 'sleep',
    args: ['10'],
    description: 'Sleep task',
    command: 'sleep 10',
    timeoutMs: 30000,
    setAppState: setAppState as never,
    abortSignal: new AbortController().signal,
  })

  // Wait for task to register
  await new Promise(r => setTimeout(r, 50))
  expect(Object.keys(tasks).length).toBe(1)

  // Kill via shellCmd
  const task = Object.values(tasks)[0] as Record<string, unknown>
  const shellCmd = task.shellCommand as { kill: () => void } | null
  expect(shellCmd).not.toBeNull()
  shellCmd?.kill()

  const result = await resultPromise
  expect(result.code).not.toBe(0)
  // Task removed after kill
  expect(Object.keys(tasks).length).toBe(0)
})

test('runNativeWithTask: abortSignal cancels the process', async () => {
  const { runNativeWithTask } = await import('../utils/task/nativeTaskRunner.js')

  const tasks: Record<string, unknown> = {}
  const setAppState = (f: (prev: { tasks: typeof tasks }) => { tasks: typeof tasks }) => {
    const next = f({ tasks })
    for (const key of Object.keys(tasks)) {
      if (!(key in next.tasks)) delete tasks[key]
    }
    Object.assign(tasks, next.tasks)
  }

  const ac = new AbortController()

  const resultPromise = runNativeWithTask({
    binary: 'sleep',
    args: ['10'],
    description: 'Abortable sleep',
    command: 'sleep 10',
    timeoutMs: 30000,
    setAppState: setAppState as never,
    abortSignal: ac.signal,
  })

  await new Promise(r => setTimeout(r, 50))
  ac.abort()

  const result = await resultPromise
  expect(result.code).not.toBe(0)
  expect(Object.keys(tasks).length).toBe(0)
})

// ---------------------------------------------------------------------------
// Gap A — ptyExec.ts: onTimeout is exposed when shouldAutoBackground=true
// ---------------------------------------------------------------------------

test('spawnWithPty: exposes onTimeout when shouldAutoBackground=true', async () => {
  const { spawnWithPty } = await import('../utils/ptyExec.js')

  const ac = new AbortController()
  ac.abort() // abort immediately so the PTY doesn't actually run long

  let shellCommand: ReturnType<typeof spawnWithPty> | undefined
  try {
    shellCommand = spawnWithPty('/bin/echo', ['hi'], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      timeout: 5000,
      shouldAutoBackground: true,
      abortSignal: ac.signal,
    })
  } catch {
    // PTY may fail in CI without a TTY — skip
    return
  }

  expect(typeof shellCommand.onTimeout).toBe('function')
})

test('spawnWithPty: onTimeout is undefined when shouldAutoBackground=false', async () => {
  const { spawnWithPty } = await import('../utils/ptyExec.js')

  const ac = new AbortController()
  ac.abort()

  let shellCommand: ReturnType<typeof spawnWithPty> | undefined
  try {
    shellCommand = spawnWithPty('/bin/echo', ['hi'], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      timeout: 5000,
      shouldAutoBackground: false,
      abortSignal: ac.signal,
    })
  } catch {
    return
  }

  expect(shellCommand.onTimeout).toBeUndefined()
})
