/**
 * Shared utilities for ADReconTool and ADAttackTool.
 * Centralizes: output directory management, NT hash normalization, and
 * the common runNativeWithTask invocation pattern.
 */

import { mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve } from 'path'
import type { ToolUseContext } from '../../Tool.js'
import { runNativeWithTask } from '../../utils/task/nativeTaskRunner.js'
import { smartTruncate } from './outputAccumulator.js'

export const TARGETS_ROOT = join(homedir(), 'Targets')

/** Max bytes to keep from stdout / stderr to avoid bloating context. */
const STDOUT_LIMIT = 50_000
const STDERR_LIMIT = 5_000

/**
 * Normalizes an NT hash to LM:NT format.
 * Accepts either a bare 32-hex NT hash or an already-formatted LM:NT pair.
 */
export function normalizeNtHash(hash: string): string {
  return hash.includes(':') ? hash : `aad3b435b51404eeaad3b435b51404ee:${hash}`
}

/**
 * Resolves auth arguments for impacket-style tools.
 * Returns `{ authArgs, hash, hasAuth }`.
 *
 * @param username  - Attacker-controlled username (empty string = unauthenticated)
 * @param password  - Cleartext password (may be empty)
 * @param ntHash    - Raw NT hash string from tool input (optional)
 */
export function resolveAuth(
  username: string,
  password: string,
  ntHash: string | undefined,
): { hash: string; hasAuth: boolean } {
  const hash = ntHash ? normalizeNtHash(ntHash) : ''
  const hasAuth = !!(username && (password || hash))
  return { hash, hasAuth }
}

/**
 * Creates the output directory for a given domain and subdirectory.
 * Returns the resolved path. Throws if the resolved path escapes ~/Targets.
 */
export async function ensureOutputDir(domain: string, subdir: string): Promise<string> {
  const dir = resolve(TARGETS_ROOT, domain, subdir)
  if (!dir.startsWith(TARGETS_ROOT + '/')) {
    throw new Error(`Invalid domain: path must stay within ~/Targets`)
  }
  await mkdir(dir, { recursive: true })
  return dir
}

export interface ADCommandResult {
  stdout: string
  stderr: string
  code: number
}

/**
 * Runs a native AD tool with the standard task runner, applying output size limits.
 */
export async function runADCommand(
  {
    binary,
    args,
    description,
    timeoutMs,
    context,
  }: {
    binary: string
    args: string[]
    description: string
    timeoutMs: number
    context: ToolUseContext
  },
): Promise<ADCommandResult> {
  const command = `${binary} ${args.join(' ')}`
  const { stdout, stderr, code } = await runNativeWithTask({
    binary,
    args,
    description,
    command,
    timeoutMs,
    setAppState: context.setAppStateForTasks ?? context.setAppState,
    agentId: context.agentId,
    abortSignal: context.abortController.signal,
  })
  return {
    // AD tools print hashes/results at the end — tailFallback preserves what matters
    stdout: smartTruncate(stdout, STDOUT_LIMIT, { tailFallback: true }),
    stderr: smartTruncate(stderr, STDERR_LIMIT),
    code,
  }
}
