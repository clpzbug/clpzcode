import { createConnection } from 'net'
import { logForDebugging } from './debug.js'
import { clearMTLSCache } from './mtls.js'
import { clearProxyCache } from './proxy.js'

// Fast probe targets: direct IPs, no DNS — used by the stream watchdog early check.
// Multiple targets guard against a single host/port being blocked by firewall rules
// (e.g. a VPN policy that blocks 1.1.1.1 but not 8.8.8.8, or vice-versa).
const FAST_PROBE_TARGETS = [
  { host: '1.1.1.1', port: 443 }, // Cloudflare anycast
  { host: '8.8.8.8', port: 443 }, // Google anycast
]
// Thorough probe: used by recoveryLoop to confirm the actual API endpoint is reachable.
// After a VPN transition, fast IPs (no DNS) pass before the VPN's DNS resolver is ready
// for api.anthropic.com — this two-phase check prevents premature recovery confirmation.
const API_PROBE_TARGET = { host: 'api.anthropic.com', port: 443 }
const PROBE_TIMEOUT_MS = 2_000
const PROBE_INTERVAL_MS = 1_000

interface Waiter {
  resolve: () => void
  reject: (e: Error) => void
}

/**
 * Singleton that detects network outages (e.g. VPN transitions) and notifies
 * waiting callers when connectivity is restored.
 *
 * Usage:
 *   networkMonitor.onNetworkError()          // call when ENETUNREACH etc. fires
 *   await networkMonitor.waitForConnectivity() // suspend until network is back
 */
class NetworkMonitor {
  private recovering = false
  private waiters = new Set<Waiter>()

  /**
   * Run a fast probe (direct IPs, no DNS) and return true if the network is reachable.
   * Does NOT enter recovery mode — use this for on-demand checks (e.g. stream watchdog).
   */
  async checkConnectivity(): Promise<boolean> {
    return this.fastProbe()
  }

  /**
   * Whether the monitor is currently in recovery mode (waiting for network to come back).
   * Useful for UI feedback so the user knows recovery is in progress.
   */
  get isRecovering(): boolean {
    return this.recovering
  }

  /**
   * Notify the monitor that a network-level failure occurred.
   * Idempotent — multiple calls while already recovering are no-ops.
   * Starts background TCP probing; resolves all waitForConnectivity() calls
   * once connectivity is confirmed.
   */
  onNetworkError(): void {
    if (this.recovering) return
    this.recovering = true
    logForDebugging('[NetworkMonitor] network error detected — starting recovery probe')
    void this.recoveryLoop()
  }

  /**
   * Returns a promise that resolves when the next successful probe fires,
   * or rejects if timeoutMs elapses first or signal is aborted.
   *
   * If the monitor is not currently in recovery mode, one probe is issued
   * immediately to confirm connectivity before returning.
   */
  async waitForConnectivity(timeoutMs = 120_000, signal?: AbortSignal): Promise<void> {
    if (!this.recovering) {
      const ok = await this.fastProbe()
      if (ok) return
      this.onNetworkError()
    }

    if (signal?.aborted) throw new Error('Aborted waiting for network')

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve() {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          resolve()
        },
        reject(e) {
          clearTimeout(timer)
          reject(e)
        },
      }

      const onAbort = () => {
        this.waiters.delete(waiter)
        waiter.reject(new Error('Aborted waiting for network'))
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        this.waiters.delete(waiter)
        reject(new Error(`Network did not recover within ${timeoutMs}ms`))
      }, timeoutMs)

      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.add(waiter)
    })
  }

  /** Fast probe using direct IPs — no DNS, for stream watchdog / on-demand checks. */
  private fastProbe(): Promise<boolean> {
    return Promise.any(FAST_PROBE_TARGETS.map(({ host, port }) => this.tcpProbe(host, port)))
      .then(() => true)
      .catch(() => false)
  }

  /**
   * Two-phase probe used by recoveryLoop:
   *  1. Fast IP probe (no DNS) — confirms basic internet connectivity.
   *  2. If that passes, TCP probe to api.anthropic.com (requires DNS resolution).
   *
   * This prevents premature recovery after a VPN transition where fast IPs pass
   * but the VPN's DNS resolver hasn't yet resolved api.anthropic.com.
   */
  private async thoroughProbe(): Promise<boolean> {
    const basicOk = await this.fastProbe()
    if (!basicOk) return false
    return this.tcpProbe(API_PROBE_TARGET.host, API_PROBE_TARGET.port)
      .then(() => true)
      .catch(() => false)
  }

  private tcpProbe(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(port, host)
      const finish = (ok: boolean) => {
        clearTimeout(timer)
        socket.destroy()
        ok ? resolve() : reject(new Error('probe failed'))
      }
      const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS)
      socket.once('connect', () => finish(true))
      socket.once('error', () => finish(false))
    })
  }

  private async recoveryLoop(): Promise<void> {
    while (this.recovering) {
      await new Promise<void>(r => setTimeout(r, PROBE_INTERVAL_MS))
      const ok = await this.thoroughProbe()
      if (ok) {
        logForDebugging('[NetworkMonitor] connectivity restored — clearing agent caches')
        // Clear memoized HTTP agent caches so the next request opens fresh
        // connections through the (potentially new) network interface.
        clearProxyCache()
        clearMTLSCache()
        this.recovering = false
        const waiters = [...this.waiters]
        this.waiters.clear()
        for (const w of waiters) w.resolve()
      }
    }
  }
}

export const networkMonitor = new NetworkMonitor()

/**
 * Returns true while the network monitor is actively waiting for connectivity
 * to be restored after a detected outage (e.g. VPN transition, IP change).
 * Intended for UI feedback — poll at low frequency (e.g. every 300ms).
 */
export function isNetworkRecovering(): boolean {
  return networkMonitor.isRecovering
}
