import { createServer } from 'node:net'
import type { Subprocess } from 'execa'
import treeKill from 'tree-kill'
import { registerCleanup } from '../../utils/cleanupRegistry.js'

export type ManagedProcess = {
  name: string
  cmd: string
  cwd: string
  pid: number
  port: number | null
  startedAt: number
  logLines: string[]
  process: Subprocess
}

const MAX_LOG_LINES = 500

const registry = new Map<string, ManagedProcess>()
let cleanupRegistered = false

export function getProcess(name: string): ManagedProcess | undefined {
  return registry.get(name)
}

export function getAllProcesses(): ManagedProcess[] {
  return Array.from(registry.values())
}

export function registerProcess(proc: ManagedProcess): void {
  registry.set(proc.name, proc)
  if (!cleanupRegistered) {
    cleanupRegistered = true
    // Kill any still-running managed background processes on graceful shutdown
    // so they don't orphan and accumulate across restarts.
    registerCleanup(() => killAllProcesses())
  }
}

export async function killAllProcesses(): Promise<void> {
  await Promise.allSettled(
    Array.from(registry.keys()).map(name => killProcess(name)),
  )
}

export function unregisterProcess(name: string): void {
  registry.delete(name)
}

export function appendLog(name: string, line: string): void {
  const proc = registry.get(name)
  if (!proc) return
  proc.logLines.push(line)
  if (proc.logLines.length > MAX_LOG_LINES) {
    proc.logLines.splice(0, proc.logLines.length - MAX_LOG_LINES)
  }
}

export async function killProcess(name: string): Promise<void> {
  const proc = registry.get(name)
  if (!proc) return
  await new Promise<void>(resolve => {
    treeKill(proc.pid, 'SIGTERM', () => resolve())
  })
  registry.delete(name)
}

export async function getAvailablePort(start = 3000): Promise<number> {
  for (let port = start; port < start + 200; port++) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`No free port found in range ${start}–${start + 200}`)
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => { server.close(); resolve(false) })
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}
