/**
 * V8 GC hint — only has effect when the binary is launched with --expose-gc.
 * Call after releasing large allocations (post-compact, tool result eviction)
 * to prevent heap from staying inflated until natural collection pressure.
 *
 * Calls both global.gc() (V8) and Bun.gc(true) when available. Bun.gc(true)
 * is synchronous and more aggressively returns pages to the OS, preventing
 * RSS from staying inflated after large deallocations like post-compact.
 */
export function hintGC(): void {
  ;(global as { gc?: () => void }).gc?.()
  // Bun.gc(true) = synchronous, returns memory to OS. Bun.gc(false) = async.
  ;(globalThis as { Bun?: { gc: (sync: boolean) => void } }).Bun?.gc(true)
}
