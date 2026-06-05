// Integration test for the cross-process credential refresh lock (audit #18).
// Uses a real temp CLAUDE_CONFIG_DIR + real lockfile, so it exercises the
// actual mutual-exclusion + the BOUNDED fallback (no hang).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { withCredentialRefreshLock } from './credentialRefreshLock.js'
import * as lockfile from './lockfile.js'
import { getClaudeConfigHomeDir } from './envUtils.js'

describe('withCredentialRefreshLock', () => {
  let dir: string
  let savedConfigDir: string | undefined

  beforeEach(() => {
    savedConfigDir = process.env.CLAUDE_CONFIG_DIR
    dir = mkdtempSync(join(tmpdir(), 'credlock-'))
    process.env.CLAUDE_CONFIG_DIR = dir // getClaudeConfigHomeDir is keyed off this
  })
  afterEach(() => {
    if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
    rmSync(dir, { recursive: true, force: true })
  })

  test('acquires, runs fn, returns its result, and releases (re-acquirable)', async () => {
    let ran = 0
    const r1 = await withCredentialRefreshLock(async () => {
      ran++
      return 'A'
    })
    expect(r1).toEqual({ acquired: true, result: 'A' })
    expect(ran).toBe(1)
    // Released → immediately re-acquirable.
    const r2 = await withCredentialRefreshLock(async () => 'B')
    expect(r2).toEqual({ acquired: true, result: 'B' })
  })

  test('releases the lock even when fn throws', async () => {
    await expect(
      withCredentialRefreshLock(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    // Lock must be free again.
    const after = await withCredentialRefreshLock(async () => 'ok')
    expect(after).toEqual({ acquired: true, result: 'ok' })
  })

  test('returns acquired:false (does NOT run fn, does NOT hang) when a sibling holds the lock', async () => {
    // Simulate another process holding the lock on the same dir.
    const release = await lockfile.lock(getClaudeConfigHomeDir())
    try {
      let ran = false
      const r = await withCredentialRefreshLock(async () => {
        ran = true
        return 'should-not-run'
      })
      expect(r).toEqual({ acquired: false })
      expect(ran).toBe(false)
    } finally {
      await release()
    }
    // Once the sibling releases, we can acquire again.
    const after = await withCredentialRefreshLock(async () => 'recovered')
    expect(after).toEqual({ acquired: true, result: 'recovered' })
  }, 15_000)
})
