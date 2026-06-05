import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { getSessionId } from '../bootstrap/state.js'
import { logForDebugging } from '../utils/debug.js'
import { sleep } from '../utils/sleep.js'
import { jsonStringify, jsonParse } from '../utils/slowOperations.js'

const MAX_PENDING = 200
let MAX_BYTES = 1024 * 1024

export type WeakPointKind = 'crash' | 'error' | 'react'

export interface WeakPoint {
  ts: number
  sessionId: string
  kind: WeakPointKind
  source: string
  name: string
  message: string
  stackHead?: string
}

function diagnosticsDir(): string {
  return join(getClaudeConfigHomeDir(), 'diagnostics')
}

function weakPointsFile(): string {
  return join(diagnosticsDir(), 'weak-points.jsonl')
}

function shouldSkip(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY)
  )
}

function kindFor(source: string): WeakPointKind {
  if (source === 'react') {
    return 'react'
  }
  if (source === 'uncaughtException' || source === 'unhandledRejection') {
    return 'crash'
  }
  return 'error'
}

function toEntry(err: unknown, source: string): WeakPoint {
  const e = err instanceof Error ? err : undefined
  return {
    ts: Date.now(),
    sessionId: getSessionId(),
    kind: kindFor(source),
    source,
    name: e?.name ?? 'unknown',
    message: String(e?.message ?? err ?? '').slice(0, 500),
    stackHead: e?.stack?.split('\n').slice(0, 3).join('\n').slice(0, 1000),
  }
}

const pending: WeakPoint[] = []
let isWriting = false
let writeRetries = 0

function pushBounded(wp: WeakPoint): void {
  pending.push(wp)
  if (pending.length > MAX_PENDING) {
    pending.shift()
  }
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const s = await stat(weakPointsFile())
    if (s.size <= MAX_BYTES) {
      return
    }
    const tmp = `${weakPointsFile()}.tmp.${process.pid}.${Date.now()}`
    await writeFile(tmp, await readFile(weakPointsFile()))
    await rename(tmp, `${weakPointsFile()}.1`)
    await writeFile(weakPointsFile(), '')
  } catch {
    // file missing or not rotatable yet; ignore
  }
}

async function flush(): Promise<void> {
  if (isWriting || pending.length === 0 || shouldSkip()) {
    return
  }
  isWriting = true
  const batch = pending.splice(0, pending.length)
  try {
    await mkdir(diagnosticsDir(), { recursive: true })
    await rotateIfNeeded()
    await appendFile(
      weakPointsFile(),
      batch.map(b => jsonStringify(b) + '\n').join(''),
    )
    writeRetries = 0
  } catch (err) {
    logForDebugging(`Failed to flush weak points: ${err}`)
    pending.unshift(...batch)
    writeRetries++
    if (writeRetries > 5) {
      pending.length = 0
      writeRetries = 0
    }
  } finally {
    isWriting = false
    if (pending.length > 0) {
      await sleep(500)
      void flush()
    }
  }
}

export function recordWeakPoint(err: unknown, source: string): void {
  if (shouldSkip()) {
    return
  }
  try {
    pushBounded(toEntry(err, source))
    void flush()
  } catch {
    // recording must never throw into the caller
  }
}

export function recordWeakPointSync(err: unknown, source: string): void {
  if (shouldSkip()) {
    return
  }
  try {
    const wp = toEntry(err, source)
    pushBounded(wp)
    mkdirSync(diagnosticsDir(), { recursive: true })
    appendFileSync(weakPointsFile(), jsonStringify(wp) + '\n')
  } catch {
    // uncaughtException path: heap may be corrupt, best-effort only
  }
}

export async function readWeakPoints(): Promise<WeakPoint[]> {
  const out: WeakPoint[] = []
  for (const path of [`${weakPointsFile()}.1`, weakPointsFile()]) {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) {
        continue
      }
      try {
        out.push(jsonParse(line) as WeakPoint)
      } catch {
        // skip malformed line
      }
    }
  }
  return out
}

export async function cleanupOldWeakPoints(cutoff: Date): Promise<void> {
  const dir = diagnosticsDir()
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  const cutoffMs = cutoff.getTime()
  for (const name of entries) {
    try {
      const entryPath = join(dir, name)
      const s = await stat(entryPath)
      if (s.isFile() && s.mtimeMs < cutoffMs) {
        await unlink(entryPath)
      }
    } catch {
      // skip files that can't be processed
    }
  }
}

export const __testing = {
  getPendingLength: (): number => pending.length,
  isWriting: (): boolean => isWriting,
  setMaxBytes: (bytes: number): number => {
    const prev = MAX_BYTES
    MAX_BYTES = bytes
    return prev
  },
  reset: (): void => {
    pending.length = 0
    isWriting = false
    writeRetries = 0
    MAX_BYTES = 1024 * 1024
  },
  flush,
  weakPointsFile,
  diagnosticsDir,
}
