import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { pruneOneMemoryDir } from './cleanup.ts'

let parentDir: string

afterEach(async () => {
  if (parentDir) {
    await rm(parentDir, { recursive: true, force: true })
  }
})

async function setupMemoryDir(): Promise<string> {
  parentDir = await mkdtemp(join(tmpdir(), 'mem-prune-'))
  const memoryDir = join(parentDir, 'memory')
  await mkdir(memoryDir, { recursive: true })
  return memoryDir
}

async function writeTopic(dir: string, name: string, mtime?: Date): Promise<void> {
  const path = join(dir, name)
  await writeFile(path, `---\nname: ${name}\ntype: user\n---\nbody`)
  if (mtime) await utimes(path, mtime, mtime)
}

test('deletes abandoned .tmp orphan files but keeps recent ones', async () => {
  const memoryDir = await setupMemoryDir()
  const stale = join(memoryDir, 'note.md.tmp.123.456')
  const fresh = join(memoryDir, 'note.md.tmp.789.012')
  await writeFile(stale, 'x')
  await writeFile(fresh, 'x')
  await utimes(stale, new Date(Date.now() - 2 * 60 * 60 * 1000), new Date(Date.now() - 2 * 60 * 60 * 1000))

  const result = await pruneOneMemoryDir(memoryDir)

  const remaining = await readdir(memoryDir)
  expect(remaining).not.toContain('note.md.tmp.123.456')
  expect(remaining).toContain('note.md.tmp.789.012')
  expect(result.messages).toBe(1)
})

test('archives the oldest unreferenced topic files over the cap, keeping referenced ones', async () => {
  const memoryDir = await setupMemoryDir()
  await writeFile(join(memoryDir, 'MEMORY.md'), '# Index\n- [Keep](keep.md) — hook\n')
  await writeTopic(memoryDir, 'keep.md', new Date(1000)) // referenced → never archived
  await writeTopic(memoryDir, 'old1.md', new Date(1000)) // oldest unreferenced
  await writeTopic(memoryDir, 'old2.md', new Date(2000))
  await writeTopic(memoryDir, 'new.md', new Date(3000))

  // cap=2, 4 topic files → archive 2 oldest unreferenced (old1, old2)
  await pruneOneMemoryDir(memoryDir, 2)

  const remaining = await readdir(memoryDir)
  expect(remaining.sort()).toEqual(['MEMORY.md', 'keep.md', 'new.md'])
  const archived = await readdir(join(parentDir, 'memory-archive'))
  expect(archived.sort()).toEqual(['old1.md', 'old2.md'])
})

test('never archives a referenced file even when over cap', async () => {
  const memoryDir = await setupMemoryDir()
  await writeFile(
    join(memoryDir, 'MEMORY.md'),
    '- [A](a.md)\n- [B](b.md)\n',
  )
  await writeTopic(memoryDir, 'a.md')
  await writeTopic(memoryDir, 'b.md')

  const result = await pruneOneMemoryDir(memoryDir, 1)

  const remaining = await readdir(memoryDir)
  expect(remaining.sort()).toEqual(['MEMORY.md', 'a.md', 'b.md'])
  expect(result.messages).toBe(0)
})

test('does nothing under the cap', async () => {
  const memoryDir = await setupMemoryDir()
  await writeTopic(memoryDir, 'only.md')

  const result = await pruneOneMemoryDir(memoryDir)

  expect(result.messages).toBe(0)
  expect(await readdir(memoryDir)).toEqual(['only.md'])
})
