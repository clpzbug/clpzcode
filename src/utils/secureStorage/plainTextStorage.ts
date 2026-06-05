import { chmodSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getErrnoCode } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { writeFileSyncAndFlush_DEPRECATED } from '../file.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import type { SecureStorage, SecureStorageData } from './index.js'

function getStoragePath(): { storageDir: string; storagePath: string } {
  const storageDir = getClaudeConfigHomeDir()
  const storageFileName = '.credentials.json'
  return { storageDir, storagePath: join(storageDir, storageFileName) }
}

export const plainTextStorage = {
  name: 'plaintext',
  read(): SecureStorageData | null {
    // sync IO: called from sync context (SecureStorage interface)
    const { storagePath } = getStoragePath()
    try {
      const data = getFsImplementation().readFileSync(storagePath, {
        encoding: 'utf8',
      })
      return jsonParse(data)
    } catch {
      return null
    }
  },
  async readAsync(): Promise<SecureStorageData | null> {
    const { storagePath } = getStoragePath()
    try {
      const data = await getFsImplementation().readFile(storagePath, {
        encoding: 'utf8',
      })
      return jsonParse(data)
    } catch {
      return null
    }
  },
  update(data: SecureStorageData): { success: boolean; warning?: string } {
    // sync IO: called from sync context (SecureStorage interface)
    try {
      const { storageDir, storagePath } = getStoragePath()
      try {
        getFsImplementation().mkdirSync(storageDir)
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code !== 'EEXIST') {
          throw e
        }
      }

      // Atomic temp+rename (mirrors config.ts/settings.ts): a crash or a
      // concurrent reader must never observe a half-written/truncated
      // .credentials.json — a torn file fails jsonParse and silently logs the
      // user out. mode:0o600 sets owner-only on new files; chmod below also
      // corrects any pre-existing file written with a looser mode.
      writeFileSyncAndFlush_DEPRECATED(storagePath, jsonStringify(data), {
        encoding: 'utf8',
        mode: 0o600,
      })
      chmodSync(storagePath, 0o600)
      return {
        success: true,
        warning: 'Warning: Storing credentials in plaintext.',
      }
    } catch {
      return { success: false }
    }
  },
  delete(): boolean {
    // sync IO: called from sync context (SecureStorage interface)
    const { storagePath } = getStoragePath()
    try {
      getFsImplementation().unlinkSync(storagePath)
      return true
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return true
      }
      return false
    }
  },
} satisfies SecureStorage
