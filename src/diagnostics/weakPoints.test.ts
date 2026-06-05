import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  statSync,
  utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setClaudeConfigHomeDirForTesting } from '../utils/envUtils.js'
import {
  recordWeakPoint,
  recordWeakPointSync,
  readWeakPoints,
  cleanupOldWeakPoints,
  __testing,
} from './weakPoints.js'
import { call as weakpointsCall } from '../commands/weakpoints/weakpoints.js'

// recordWeakPoint fires an async, fire-and-forget flush. Drain it deterministically
// by awaiting until pending is empty and no write is in flight.
async function drain(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await __testing.flush()
    if (__testing.getPendingLength() === 0 && !__testing.isWriting()) {
      return
    }
    await new Promise(r => setTimeout(r, 10))
  }
}

let tmpDir: string
const origNodeEnv = process.env.NODE_ENV
const origSkip = process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'weakpoints-'))
  setClaudeConfigHomeDirForTesting(tmpDir)
  delete process.env.NODE_ENV
  delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
  __testing.reset()
})

afterEach(() => {
  __testing.reset()
  setClaudeConfigHomeDirForTesting(undefined)
  if (origNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = origNodeEnv
  }
  if (origSkip === undefined) {
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
  } else {
    process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = origSkip
  }
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('weakPoints ring buffer', () => {
  it('drops oldest beyond cap and never exceeds MAX_PENDING', () => {
    for (let i = 0; i < 500; i++) {
      recordWeakPoint(new Error(`boom-${i}`), 'logError')
    }
    // recordWeakPoint kicks off a fire-and-forget flush, but pending is bounded
    // regardless of whether a flush has drained it yet.
    expect(__testing.getPendingLength()).toBeLessThanOrEqual(200)
  })
})

describe('recordWeakPoint never throws / non-blocking', () => {
  it('returns void synchronously and does not throw on bad input', () => {
    expect(() => recordWeakPoint(undefined, 'logError')).not.toThrow()
    expect(() => recordWeakPoint('a string error', 'logError')).not.toThrow()
    expect(() => recordWeakPoint(new Error('x'), 'react')).not.toThrow()
    const ret = recordWeakPoint(new Error('y'), 'logError')
    expect(ret).toBeUndefined()
  })

  it('does not throw when the config dir is unwritable', async () => {
    // point at a path whose parent is a file => mkdir will fail
    const badParent = join(tmpDir, 'afile')
    writeFileSync(badParent, 'x')
    setClaudeConfigHomeDirForTesting(join(badParent, 'nested'))
    expect(() => recordWeakPoint(new Error('boom'), 'logError')).not.toThrow()
    // the awaited flush swallows the write error rather than rejecting
    await expect(__testing.flush()).resolves.toBeUndefined()
  })
})

describe('weakPoints persistence and read', () => {
  it('flushes pending entries to the jsonl file', async () => {
    recordWeakPoint(new Error('persist-me'), 'logError')
    await drain()
    const wp = await readWeakPoints()
    expect(wp.some(w => w.message === 'persist-me')).toBe(true)
  })

  it('tolerant read skips malformed lines', async () => {
    mkdirSync(__testing.diagnosticsDir(), { recursive: true })
    const good1 = JSON.stringify({
      ts: 1,
      sessionId: 's',
      kind: 'error',
      source: 'logError',
      name: 'E1',
      message: 'm1',
    })
    const good2 = JSON.stringify({
      ts: 2,
      sessionId: 's',
      kind: 'crash',
      source: 'uncaughtException',
      name: 'E2',
      message: 'm2',
    })
    writeFileSync(__testing.weakPointsFile(), `${good1}\n{ not json \n${good2}\n`)
    const wp = await readWeakPoints()
    expect(wp.length).toBe(2)
    expect(wp.map(w => w.message).sort()).toEqual(['m1', 'm2'])
  })
})

describe('byte-cap and rotation', () => {
  it('rotates to .1 when file exceeds MAX_BYTES, truncating the live file', async () => {
    __testing.setMaxBytes(200)
    const file = __testing.weakPointsFile()
    // seed a live file already over the cap
    mkdirSync(__testing.diagnosticsDir(), { recursive: true })
    writeFileSync(file, 'x'.repeat(500))
    // a flush should rotate the oversized file then write the fresh batch
    recordWeakPoint(new Error('second'), 'logError')
    await drain()
    expect(existsSync(`${file}.1`)).toBe(true)
    const live = readFileSync(file, 'utf8')
    const rotated = readFileSync(`${file}.1`, 'utf8')
    expect(rotated.length).toBeGreaterThan(200)
    // live file holds only the new batch, well under the on-disk ceiling
    expect(statSync(file).size).toBeLessThan(2 * 200)
    expect(live).toContain('second')
  })

  it('readWeakPoints merges rotated and live files', async () => {
    const file = __testing.weakPointsFile()
    mkdirSync(__testing.diagnosticsDir(), { recursive: true })
    writeFileSync(
      `${file}.1`,
      JSON.stringify({
        ts: 1,
        sessionId: 's',
        kind: 'error',
        source: 'logError',
        name: 'Old',
        message: 'old',
      }) + '\n',
    )
    writeFileSync(
      file,
      JSON.stringify({
        ts: 2,
        sessionId: 's',
        kind: 'error',
        source: 'logError',
        name: 'New',
        message: 'new',
      }) + '\n',
    )
    const wp = await readWeakPoints()
    expect(wp.map(w => w.message)).toEqual(['old', 'new'])
  })
})

describe('recordWeakPointSync (crash path)', () => {
  it('writes a crash entry synchronously', async () => {
    recordWeakPointSync(new Error('died'), 'uncaughtException')
    const wp = await readWeakPoints()
    const crash = wp.find(w => w.message === 'died')
    expect(crash).toBeDefined()
    expect(crash?.kind).toBe('crash')
    expect(crash?.source).toBe('uncaughtException')
  })
})

describe('opt-out', () => {
  it('writes nothing when NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test'
    recordWeakPoint(new Error('nope'), 'logError')
    recordWeakPointSync(new Error('nope2'), 'uncaughtException')
    await __testing.flush()
    expect(existsSync(__testing.weakPointsFile())).toBe(false)
  })

  it('writes nothing when CLAUDE_CODE_SKIP_PROMPT_HISTORY is set', async () => {
    process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = '1'
    recordWeakPoint(new Error('nope'), 'logError')
    recordWeakPointSync(new Error('nope2'), 'uncaughtException')
    await __testing.flush()
    expect(existsSync(__testing.weakPointsFile())).toBe(false)
  })
})

describe('cleanupOldWeakPoints', () => {
  it('unlinks files older than cutoff and keeps recent ones', async () => {
    const dir = __testing.diagnosticsDir()
    mkdirSync(dir, { recursive: true })
    const oldFile = join(dir, 'weak-points.jsonl.1')
    const newFile = join(dir, 'weak-points.jsonl')
    writeFileSync(oldFile, 'old\n')
    writeFileSync(newFile, 'new\n')
    // age the old file to 60 days ago (utimes takes seconds)
    const past = Date.now() / 1000 - 60 * 24 * 60 * 60
    utimesSync(oldFile, past, past)
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await cleanupOldWeakPoints(cutoff)
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(newFile)).toBe(true)
  })

  it('tolerates a missing diagnostics dir', async () => {
    await expect(cleanupOldWeakPoints(new Date())).resolves.toBeUndefined()
  })
})

describe('/weakpoints command output', () => {
  it('aggregates by kind+source with counts and shows recent entries', async () => {
    mkdirSync(__testing.diagnosticsDir(), { recursive: true })
    const lines = [
      { ts: 100, sessionId: 's', kind: 'error', source: 'logError', name: 'TypeError', message: 'a' },
      { ts: 200, sessionId: 's', kind: 'error', source: 'logError', name: 'RangeError', message: 'b' },
      { ts: 300, sessionId: 's', kind: 'crash', source: 'uncaughtException', name: 'Boom', message: 'c' },
    ]
    writeFileSync(
      __testing.weakPointsFile(),
      lines.map(l => JSON.stringify(l)).join('\n') + '\n',
    )
    const result = await weakpointsCall('', undefined as never)
    expect(result.type).toBe('text')
    const value = (result as { type: 'text'; value: string }).value
    expect(value).toContain('Weak points (3 total)')
    expect(value).toMatch(/2\s+error \/ logError/)
    expect(value).toMatch(/1\s+crash \/ uncaughtException/)
    expect(value).toContain('[crash/uncaughtException] Boom: c')
  })

  it('reports no weak points when none recorded', async () => {
    const result = await weakpointsCall('', undefined as never)
    expect(result).toEqual({ type: 'text', value: 'No weak points recorded.' })
  })
})
