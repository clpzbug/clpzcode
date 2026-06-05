import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import { execSync_DEPRECATED } from './execSyncWrapper.js'

const execFileAsync = promisify(execFile)

async function whichNodeAsync(command: string): Promise<string | null> {
  if (process.platform === 'win32') {
    // On Windows, use where.exe and return the first result.
    // Pass command as a separate arg (no shell) to prevent injection.
    try {
      const { stdout } = await execFileAsync('where.exe', [command], { timeout: 5000 })
      return stdout.trim().split(/\r?\n/)[0] || null
    } catch {
      return null
    }
  }

  // On POSIX systems (macOS, Linux, WSL), use which as a separate arg (no shell).
  // The old implementation used execa(`which ${command}`, {shell: true}) which
  // interpolates command into a shell string — any shell metacharacter in command
  // (spaces, $(...), ; etc.) would be interpreted. execFile avoids this entirely.
  try {
    const { stdout } = await execFileAsync('which', [command], { timeout: 5000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function whichNodeSync(command: string): string | null {
  if (process.platform === 'win32') {
    try {
      const result = execSync_DEPRECATED(`where.exe ${command}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const output = result.toString().trim()
      return output.split(/\r?\n/)[0] || null
    } catch {
      return null
    }
  }

  // Sync path: use execFileSync to avoid shell interpolation
  try {
    const result = execFileSync('which', [command], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
    return (result as string).trim() || null
  } catch {
    return null
  }
}

const bunWhich =
  typeof Bun !== 'undefined' && typeof Bun.which === 'function'
    ? Bun.which
    : null

/**
 * Finds the full path to a command executable.
 * Uses Bun.which when running in Bun (fast, no process spawn),
 * otherwise spawns the platform-appropriate command without a shell
 * to prevent command injection via metacharacters in command name.
 *
 * @param command - The command name to look up
 * @returns The full path to the command, or null if not found
 */
export const which: (command: string) => Promise<string | null> = bunWhich
  ? async command => bunWhich(command)
  : whichNodeAsync

/**
 * Synchronous version of `which`.
 *
 * @param command - The command name to look up
 * @returns The full path to the command, or null if not found
 */
export const whichSync: (command: string) => string | null =
  bunWhich ?? whichNodeSync
