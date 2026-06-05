// src/tools/MultiEditTool/MultiEditTool.call.test.ts
//
// Regression for two audit-confirmed HIGH bugs in MultiEditTool.call:
//  (1) it never refreshed readFileState after writing, so a second edit of the
//      same file in-session was wrongly rejected as "modified since read";
//  (2) it read/wrote raw UTF-8 with no CRLF normalization, so a CRLF file with
//      an LF old_string failed ("String not found") and line endings were lost.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ToolUseContext } from '../../Tool.js'
import { getFileModificationTime } from '../../utils/file.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { MultiEditTool } from './MultiEditTool.js'

function ctxWith(readFileState: ReturnType<typeof createFileStateCacheWithSizeLimit>) {
  return { readFileState } as unknown as ToolUseContext
}

describe('MultiEditTool.call', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'multiedit-call-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('refreshes readFileState after writing (next edit is not falsely stale)', async () => {
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'hello world\n')
    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set(file, {
      content: 'hello world\n',
      timestamp: getFileModificationTime(file),
      offset: undefined,
      limit: undefined,
    })
    const r = await MultiEditTool.call!(
      { edits: [{ file_path: file, old_string: 'hello', new_string: 'hi' }] },
      ctxWith(cache),
    )
    expect(r.data.results[0]).toEqual({ file_path: file, success: true })
    // The bug: readFileState still held the pre-edit content/timestamp.
    const st = cache.get(file)
    expect(st?.content).toBe('hi world\n')
    expect(st?.timestamp).toBe(getFileModificationTime(file))
  })

  test('aborts (does not clobber) a file modified on disk since it was read', async () => {
    const file = join(dir, 'b.txt')
    writeFileSync(file, 'v1\n')
    const cache = createFileStateCacheWithSizeLimit(10)
    // Recorded read with a stale timestamp (any real mtime will exceed it).
    cache.set(file, { content: 'v1\n', timestamp: 1, offset: undefined, limit: undefined })
    // An external editor changes the file after our read, before the write.
    writeFileSync(file, 'EXTERNALLY CHANGED\n')
    const r = await MultiEditTool.call!(
      { edits: [{ file_path: file, old_string: 'v1', new_string: 'v2' }] },
      ctxWith(cache),
    )
    const res0 = r.data.results[0]!
    expect(res0.success).toBe(false)
    if (!res0.success) expect(res0.error).toContain('modified since')
    // The external content must survive — MultiEdit must not clobber it.
    expect(readFileSync(file, 'utf8')).toBe('EXTERNALLY CHANGED\n')
  })

  test('edits a CRLF file via an LF old_string and preserves CRLF on disk', async () => {
    const file = join(dir, 'crlf.txt')
    writeFileSync(file, 'foo\r\nbar\r\n') // CRLF on disk
    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set(file, {
      content: 'foo\nbar\n', // what a normalized Read stored
      timestamp: getFileModificationTime(file),
      offset: undefined,
      limit: undefined,
    })
    const r = await MultiEditTool.call!(
      { edits: [{ file_path: file, old_string: 'foo\nbar', new_string: 'baz\nqux' }] },
      ctxWith(cache),
    )
    expect(r.data.results[0]).toEqual({ file_path: file, success: true })
    // CRLF preserved on disk (the bug wrote LF and/or failed to match).
    expect(readFileSync(file, 'utf8')).toBe('baz\r\nqux\r\n')
    // readFileState stores the LF-normalized form.
    expect(cache.get(file)?.content).toBe('baz\nqux\n')
  })
})
