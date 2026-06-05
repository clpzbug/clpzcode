import { LRUCache } from 'lru-cache'
import { detectFileEncoding } from './file.js'
import { getFsImplementation } from './fsOperations.js'

type CachedFileData = {
  content: string
  encoding: BufferEncoding
  mtime: number
}

// 25MB cap by bytes (mirrors fileStateCache.ts:22) — bounds memory regardless
// of how many files are cached. The old count-only bound (1000 entries) had a
// theoretical GB ceiling (1000 × arbitrary file size). MEMORY-AND-RUNTIME-PLAN
// §2 #4 / RAM-DEEPDIVE §2.6.
const MAX_CACHE_SIZE_BYTES = 25 * 1024 * 1024

/**
 * A simple in-memory cache for file contents with automatic invalidation based on modification time.
 * This eliminates redundant file reads in FileEditTool operations.
 */
class FileReadCache {
  private cache = new LRUCache<string, CachedFileData>({
    maxSize: MAX_CACHE_SIZE_BYTES,
    sizeCalculation: value => Math.max(1, Buffer.byteLength(value.content)),
  })

  /**
   * Reads a file with caching. Returns both content and encoding.
   * Cache key includes file path and modification time for automatic invalidation.
   */
  readFile(filePath: string): { content: string; encoding: BufferEncoding } {
    const fs = getFsImplementation()

    // Get file stats for cache invalidation
    let stats
    try {
      stats = fs.statSync(filePath)
    } catch (error) {
      // File was deleted, remove from cache and re-throw
      this.cache.delete(filePath)
      throw error
    }

    const cacheKey = filePath
    const cachedData = this.cache.get(cacheKey)

    // Check if we have valid cached data
    if (cachedData && cachedData.mtime === stats.mtimeMs) {
      return {
        content: cachedData.content,
        encoding: cachedData.encoding,
      }
    }

    // Cache miss or stale data - read the file
    const encoding = detectFileEncoding(filePath)
    const content = fs
      .readFileSync(filePath, { encoding })
      .replaceAll('\r\n', '\n')

    // Update cache — LRUCache evicts by byte size (maxSize) automatically.
    this.cache.set(cacheKey, {
      content,
      encoding,
      mtime: stats.mtimeMs,
    })

    return { content, encoding }
  }

  /**
   * Clears the entire cache. Useful for testing or memory management.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Removes a specific file from the cache.
   */
  invalidate(filePath: string): void {
    this.cache.delete(filePath)
  }

  /**
   * Gets cache statistics for debugging/monitoring.
   */
  getStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    }
  }
}

// Export a singleton instance
export const fileReadCache = new FileReadCache()
