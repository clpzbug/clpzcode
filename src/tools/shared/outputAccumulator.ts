/**
 * Output accumulator with automatic disk spill.
 *
 * Buffers subprocess output in memory up to SPILL_THRESHOLD bytes.
 * When exceeded, flushes to a temp file so the process can keep running
 * without OOM-killing the Node heap.
 *
 * Inspired by pi/coding-agent's OutputAccumulator pattern.
 *
 * Usage:
 *   const acc = new OutputAccumulator()
 *   proc.stdout.on('data', chunk => acc.append(chunk.toString()))
 *   const text = acc.read({ maxChars: 50_000, tailFallback: true })
 */

import { appendFile, readFile, rm } from 'fs/promises'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const SPILL_THRESHOLD = 200_000 // 200 KB — spill to disk beyond this

export class OutputAccumulator {
  private buf = ''
  private spillPath: string | undefined = undefined
  private totalBytes = 0

  /** Append a chunk of text output. */
  append(chunk: string): void {
    this.totalBytes += chunk.length
    if (!this.spillPath && this.buf.length + chunk.length > SPILL_THRESHOLD) {
      // Flush existing buffer synchronously by kicking off async spill.
      // Since append() is sync we can't await; spill on next tick via promise.
      void this._initSpill(chunk)
    } else if (this.spillPath) {
      // Already spilling — write directly to file (fire-and-forget; ordering
      // is best-effort since append() is called synchronously by event handlers)
      void appendFile(this.spillPath, chunk, 'utf8')
    } else {
      this.buf += chunk
    }
  }

  /**
   * Read accumulated output.
   *
   * @param maxChars  Max characters to return (default: all)
   * @param tailFallback  When true AND output was truncated from the head,
   *                      prefer the most-recent content (tail) over the first
   *                      chunk. Default: false (return head).
   */
  async read(opts: { maxChars?: number; tailFallback?: boolean } = {}): Promise<string> {
    const { maxChars, tailFallback = false } = opts
    let full: string

    if (this.spillPath) {
      // Wait for any in-flight appendFile calls to settle by re-reading the file
      await new Promise(r => setTimeout(r, 50))
      full = await readFile(this.spillPath, 'utf8').catch(() => this.buf)
    } else {
      full = this.buf
    }

    if (!maxChars || full.length <= maxChars) {
      return full
    }

    if (tailFallback) {
      // Return the last maxChars (most recent output — e.g. final scan results)
      return `[... ${full.length - maxChars} chars truncated from head ...]\n` +
        full.slice(full.length - maxChars)
    }

    return full.slice(0, maxChars) +
      `\n[... ${full.length - maxChars} more chars truncated ...]`
  }

  /** Total bytes accumulated (including spilled). */
  get size(): number {
    return this.totalBytes
  }

  /** Clean up the spill file if one was created. */
  async cleanup(): Promise<void> {
    if (this.spillPath) {
      await rm(this.spillPath, { force: true })
      this.spillPath = undefined
    }
    this.buf = ''
    this.totalBytes = 0
  }

  private async _initSpill(firstChunk: string): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'outacc-'))
    const path = join(dir, 'output.txt')
    this.spillPath = path
    await appendFile(path, this.buf + firstChunk, 'utf8')
    this.buf = '' // release memory
  }
}

/**
 * Convenience: accumulate a complete string, return a trimmed slice.
 * Useful when you already have the full output (e.g. from execFile) but
 * want intelligent truncation.
 */
export function smartTruncate(
  output: string,
  maxChars: number,
  opts: { tailFallback?: boolean } = {},
): string {
  if (output.length <= maxChars) return output

  const { tailFallback = false } = opts
  if (tailFallback) {
    return `[... ${output.length - maxChars} chars from head omitted ...]\n` +
      output.slice(output.length - maxChars)
  }
  return output.slice(0, maxChars) +
    `\n[... ${output.length - maxChars} more chars ...]`
}
