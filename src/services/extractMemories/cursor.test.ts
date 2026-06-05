import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readCursorFile, writeCursorFile } from './extractMemories.ts'

let tempDir: string

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('cursor round-trips through write then read', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-cursor-'))
  const path = join(tempDir, 'memory', '.extract-cursor.json')
  writeCursorFile(path, 'uuid-123')
  expect(readCursorFile(path)).toBe('uuid-123')
})

test('writeCursorFile creates missing parent directories', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-cursor-'))
  const path = join(tempDir, 'a', 'b', 'c', '.extract-cursor.json')
  writeCursorFile(path, 'deep')
  expect(readCursorFile(path)).toBe('deep')
})

test('readCursorFile returns undefined for a missing file', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-cursor-'))
  expect(readCursorFile(join(tempDir, 'nope.json'))).toBeUndefined()
})

test('readCursorFile returns undefined for corrupt JSON', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-cursor-'))
  const path = join(tempDir, 'corrupt.json')
  await writeFile(path, '{ not valid json')
  expect(readCursorFile(path)).toBeUndefined()
})

test('readCursorFile returns undefined when the uuid field is absent', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-cursor-'))
  const path = join(tempDir, 'nouuid.json')
  await writeFile(path, JSON.stringify({ updatedAt: 123 }))
  expect(readCursorFile(path)).toBeUndefined()
})
