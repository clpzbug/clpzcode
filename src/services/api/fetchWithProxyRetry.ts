import { networkMonitor } from '../../utils/networkMonitor.js'
import { disableKeepAlive, getProxyFetchOptions } from '../../utils/proxy.js'

const RETRYABLE_FETCH_ERROR_PATTERN =
  /socket connection was closed unexpectedly|ECONNRESET|EPIPE|socket hang up|Connection reset by peer|fetch failed|ENETUNREACH|EHOSTUNREACH|ENETDOWN/i

const NETWORK_UNREACHABLE_PATTERN = /ENETUNREACH|EHOSTUNREACH|ENETDOWN/i

export function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return false
  return RETRYABLE_FETCH_ERROR_PATTERN.test(error.message)
}

function isNetworkUnreachableError(error: unknown): boolean {
  return error instanceof Error && NETWORK_UNREACHABLE_PATTERN.test(error.message)
}

export async function fetchWithProxyRetry(
  input: string | URL | Request,
  init?: RequestInit,
  options?: { forAnthropicAPI?: boolean; maxAttempts?: number; signal?: AbortSignal },
): Promise<Response> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 2)
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(input, {
        ...init,
        ...getProxyFetchOptions({ forAnthropicAPI: options?.forAnthropicAPI }),
      })
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts || !isRetryableFetchError(error)) throw error
      disableKeepAlive()
      if (isNetworkUnreachableError(error)) {
        // Network interface changed (e.g. VPN transition). Wait for
        // connectivity to return before retrying with fresh agent caches.
        networkMonitor.onNetworkError()
        await networkMonitor.waitForConnectivity(60_000, options?.signal)
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Fetch failed without an error object')
}
