import { mkdir } from 'fs/promises'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage } from './errors.js'
import * as lockfile from './lockfile.js'

export type RefreshLockResult<T> =
  | { acquired: true; result: T }
  | { acquired: false }

/**
 * Run `fn` while holding a cross-process lock on the shared credentials
 * directory, so concurrent clpzcode instances cannot invalidate each other's
 * rotated refresh token (a provider rotates the refresh token on every
 * refresh; two unsynchronized processes refreshing the same credentials race
 * and one ends up with a dead token). Locks the SAME directory the first-party
 * Claude OAuth refresh locks (auth.ts), so all credential refreshes serialize.
 *
 * BOUNDED — never hangs: if the lock can't be acquired within the retry window
 * (a sibling is mid-refresh), `fn` is NOT run and `{acquired:false}` is
 * returned, so the caller can re-read the (sibling-refreshed) credentials
 * instead of racing or blocking indefinitely. The lock is always released.
 */
export async function withCredentialRefreshLock<T>(
  fn: () => Promise<T>,
): Promise<RefreshLockResult<T>> {
  const dir = getClaudeConfigHomeDir()
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    /* best effort — lock acquisition below will surface a real problem */
  }
  let release: (() => Promise<void>) | undefined
  try {
    release = await lockfile.lock(dir, {
      retries: { retries: 5, minTimeout: 200, maxTimeout: 1000, randomize: true },
      // Default onCompromised throws from a setTimeout → unhandled exception.
      // Log instead — a stolen lock (e.g. after an event-loop stall) is
      // recoverable, mirroring saveConfigWithLock.
      onCompromised: err =>
        logForDebugging(`Credential refresh lock compromised: ${errorMessage(err)}`),
    })
  } catch {
    // Couldn't acquire within the bounded window — a sibling holds it.
    return { acquired: false }
  }
  try {
    return { acquired: true, result: await fn() }
  } finally {
    try {
      await release()
    } catch {
      /* already released / compromised */
    }
  }
}
