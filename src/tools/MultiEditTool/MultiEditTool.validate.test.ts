import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, statSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MultiEditTool } from './MultiEditTool.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import type { ToolUseContext } from '../../Tool.js'

// MultiEdit's validateInput only reads toolUseContext.readFileState, so a minimal
// context with a real FileStateCache exercises the Read-before-Edit guard end-to-end.
function ctxWith(readFileState: ReturnType<typeof createFileStateCacheWithSizeLimit>) {
  return { readFileState } as unknown as ToolUseContext
}

describe('MultiEditTool.validateInput (Read-before-Edit guard)', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'multiedit-'))
    file = join(dir, 'a.txt')
    writeFileSync(file, 'hello world\n')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('rejects editing a file that was never read', async () => {
    const r = await MultiEditTool.validateInput!(
      { edits: [{ file_path: file, old_string: 'hello', new_string: 'hi' }] },
      ctxWith(createFileStateCacheWithSizeLimit(10)),
    )
    expect(r.result).toBe(false)
    expect(r.message).toContain('has not been read yet')
  })

  test('allows editing after a fresh full read', async () => {
    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set(file, {
      content: 'hello world\n',
      timestamp: Math.floor(statSync(file).mtimeMs),
      offset: undefined,
      limit: undefined,
    })
    const r = await MultiEditTool.validateInput!(
      { edits: [{ file_path: file, old_string: 'hello', new_string: 'hi' }] },
      ctxWith(cache),
    )
    expect(r.result).toBe(true)
  })

  test('rejects a partial (isPartialView) read', async () => {
    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set(file, {
      content: 'hello world\n',
      timestamp: Math.floor(statSync(file).mtimeMs),
      offset: undefined,
      limit: undefined,
      isPartialView: true,
    })
    const r = await MultiEditTool.validateInput!(
      { edits: [{ file_path: file, old_string: 'hello', new_string: 'hi' }] },
      ctxWith(cache),
    )
    expect(r.result).toBe(false)
    expect(r.message).toContain('partially read')
  })

  test('rejects when the file changed on disk since the read', async () => {
    const cache = createFileStateCacheWithSizeLimit(10)
    // Stored timestamp is OLD; current file mtime is newer and content differs.
    cache.set(file, { content: 'stale\n', timestamp: 1, offset: undefined, limit: undefined })
    const r = await MultiEditTool.validateInput!(
      { edits: [{ file_path: file, old_string: 'hello', new_string: 'hi' }] },
      ctxWith(cache),
    )
    expect(r.result).toBe(false)
    expect(r.message).toContain('modified since read')
  })

  test('allows creating a new file (empty old_string) without a prior read', async () => {
    const fresh = join(dir, 'new.txt')
    const r = await MultiEditTool.validateInput!(
      { edits: [{ file_path: fresh, old_string: '', new_string: 'created' }] },
      ctxWith(createFileStateCacheWithSizeLimit(10)),
    )
    expect(r.result).toBe(true)
  })

  test('rejects creation (empty old_string) over an existing non-empty file not read', async () => {
    // `file` already exists with 'hello world\n' and was never read.
    const r = await MultiEditTool.validateInput!(
      { edits: [{ file_path: file, old_string: '', new_string: 'clobber' }] },
      ctxWith(createFileStateCacheWithSizeLimit(10)),
    )
    expect(r.result).toBe(false)
    expect(r.message).toContain('already exists')
  })

  test('tolerates same-content/different-mtime for a full read (no false reject)', async () => {
    const cache = createFileStateCacheWithSizeLimit(10)
    // Bump the file mtime forward but keep identical content (linter/cloud-sync case).
    const future = Date.now() / 1000 + 60
    utimesSync(file, future, future)
    cache.set(file, {
      content: 'hello world\n',
      timestamp: 1, // older than the bumped mtime
      offset: undefined,
      limit: undefined,
    })
    const r = await MultiEditTool.validateInput!(
      { edits: [{ file_path: file, old_string: 'hello', new_string: 'hi' }] },
      ctxWith(cache),
    )
    expect(r.result).toBe(true)
  })
})
