import { expect, test } from 'bun:test'
import { sep } from 'path'
import { getTargetProjectInfo } from './paths.ts'

test('getTargetProjectInfo returns a well-formed, inspectable snapshot', () => {
  const info = getTargetProjectInfo()

  expect(typeof info.dir).toBe('string')
  expect(info.dir.length).toBeGreaterThan(0)
  expect(typeof info.isGit).toBe('boolean')
  expect(info.gitRoot === null || typeof info.gitRoot === 'string').toBe(true)
  // isGit and gitRoot must agree
  expect(info.isGit).toBe(info.gitRoot !== null)
  expect(typeof info.autoMemoryEnabled).toBe('boolean')
  // memoryPath is the auto-memory dir — always a trailing-separated absolute path
  expect(info.memoryPath.endsWith(sep)).toBe(true)
  expect(['override', 'git-root', 'cwd']).toContain(info.scope)
})
