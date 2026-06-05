import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { cleanupOldHistory } from './history.js'

// cleanupOldHistory prunes ~/.claude/history.jsonl by per-entry timestamp under
// the writer's lock, atomically. We point CLAUDE_CONFIG_DIR at a temp dir so the
// real history is never touched.
describe('cleanupOldHistory', () => {
  let dir: string
  let prevEnv: string | undefined

  beforeEach(async () => {
    prevEnv = process.env.CLAUDE_CONFIG_DIR
    dir = await mkdtemp(join(tmpdir(), 'clpz-hist-'))
    process.env.CLAUDE_CONFIG_DIR = dir
  })

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevEnv
    await rm(dir, { recursive: true, force: true })
  })

  const DAY = 24 * 60 * 60 * 1000

  it('drops old + corrupt lines, keeps recent and timestamp-less, stays valid JSONL', async () => {
    const now = Date.now()
    const path = join(dir, 'history.jsonl')
    const lines = [
      JSON.stringify({ display: 'old-entry', pastedContents: {}, timestamp: now - 100 * DAY, sessionId: 's', project: 'p' }),
      JSON.stringify({ display: 'recent-entry', pastedContents: {}, timestamp: now - 1 * DAY, sessionId: 's', project: 'p' }),
      '{ this is not valid json',
      JSON.stringify({ display: 'legacy-no-ts', pastedContents: {}, sessionId: 's', project: 'p' }),
    ]
    await writeFile(path, lines.join('\n') + '\n', { mode: 0o600 })

    await cleanupOldHistory(new Date(now - 30 * DAY))

    const out = await readFile(path, 'utf-8')
    const kept = out.split('\n').filter(l => l.trim() !== '')
    // recent + timestamp-less survive; old + corrupt are gone.
    expect(out).toContain('recent-entry')
    expect(out).toContain('legacy-no-ts')
    expect(out).not.toContain('old-entry')
    expect(kept.length).toBe(2)
    // every remaining line is still valid JSON.
    for (const l of kept) expect(() => JSON.parse(l)).not.toThrow()
  })

  it('is a no-op when the history file does not exist', async () => {
    // No file written → must not throw and must not create one.
    await cleanupOldHistory(new Date(Date.now()))
    const exists = await readFile(join(dir, 'history.jsonl'), 'utf-8').then(() => true, () => false)
    expect(exists).toBe(false)
  })

  it('leaves the file untouched when nothing is old enough to prune', async () => {
    const now = Date.now()
    const path = join(dir, 'history.jsonl')
    const content = JSON.stringify({ display: 'fresh', pastedContents: {}, timestamp: now, sessionId: 's', project: 'p' }) + '\n'
    await writeFile(path, content, { mode: 0o600 })

    await cleanupOldHistory(new Date(now - 30 * DAY))

    expect(await readFile(path, 'utf-8')).toBe(content)
  })
})
