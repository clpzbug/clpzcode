/**
 * Per-path file mutation queue.
 *
 * Serializes concurrent writes to the same file via a Promise chain,
 * preventing interleaved writes that corrupt output files.
 *
 * Inspired by pi/coding-agent's file mutation queue pattern.
 *
 * Usage:
 *   await withFileMutex('/path/to/file.json', async () => {
 *     const data = await readFile(...)
 *     await writeFile(..., mutate(data))
 *   })
 */

const queues = new Map<string, Promise<void>>()

/**
 * Run `fn` while holding a per-path mutex.
 * Concurrent calls for the same path are serialized — they never overlap.
 * Errors in `fn` propagate to the caller but do not block subsequent calls.
 *
 * The `queues` Map is bounded: once a path's chain fully drains, its entry is
 * deleted so the Map does not grow unboundedly across a long session (one key
 * would otherwise leak per distinct path ever touched). The delete is guarded —
 * we only remove the entry if it is still THIS tail. If a later caller extended
 * the chain in the meantime, `queues.get(path)` points at a newer tail, so we
 * leave it in place and let that newer tail clean itself up. This preserves
 * serialization for the extended chain.
 */
export function withFileMutex<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(path) ?? Promise.resolve()
  const next = prev.then(fn)
  // Store a non-rejecting tail so later callers are not stuck waiting on a failed predecessor
  const tail = next.then(() => {}, () => {})
  queues.set(path, tail)
  // When this tail settles, drop the entry only if no later caller replaced it.
  void tail.then(() => {
    if (queues.get(path) === tail) {
      queues.delete(path)
    }
  })
  return next
}

/** Test seam: number of live path chains currently tracked. */
export function __mutexQueueSize(): number {
  return queues.size
}
