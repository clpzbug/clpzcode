import { isBareMode } from './envUtils.js'
import { createCombinedAbortSignal } from './combinedAbortSignal.js'
import { withCredentialRefreshLock } from './credentialRefreshLock.js'
import { getSecureStorage } from './secureStorage/index.js'
import {
  asTrimmedString,
  CODEX_REFRESH_URL,
  exchangeCodexIdTokenForApiKey,
  getCodexOAuthClientId,
  parseChatgptAccountId,
  decodeJwtPayload,
} from '../services/api/codexOAuthShared.js'

export const CODEX_STORAGE_KEY = 'codex' as const
const CODEX_TOKEN_REFRESH_SKEW_MS = 60_000
const CODEX_TOKEN_REFRESH_RETRY_COOLDOWN_MS = 60_000

export type CodexCredentialBlob = {
  apiKey?: string
  accessToken: string
  refreshToken?: string
  idToken?: string
  accountId?: string
  profileId?: string
  lastRefreshAt?: number
  lastRefreshFailureAt?: number
}

type CodexTokenRefreshResponse = {
  access_token?: string
  refresh_token?: string
  id_token?: string
}

let inFlightCodexRefresh:
  | Promise<{
      refreshed: boolean
      credentials?: CodexCredentialBlob
    }>
  | null = null
let inMemoryLastRefreshFailureAt: number | null = null

function getCodexSecureStorage() {
  return getSecureStorage({ allowPlainTextFallback: false })
}

function parseJwtExpiryMs(token: string | undefined): number | undefined {
  if (!token) return undefined
  const payload = decodeJwtPayload(token)
  const exp = payload?.exp
  if (typeof exp === 'number' && Number.isFinite(exp)) {
    return exp * 1000
  }
  return undefined
}

function normalizeCodexCredentialBlob(
  value: unknown,
): CodexCredentialBlob | undefined {
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  const apiKey = asTrimmedString(record.apiKey)
  const accessToken = asTrimmedString(record.accessToken)
  if (!accessToken) return undefined

  const refreshToken = asTrimmedString(record.refreshToken)
  const idToken = asTrimmedString(record.idToken)
  const accountId =
    asTrimmedString(record.accountId) ??
    parseChatgptAccountId(idToken) ??
    parseChatgptAccountId(accessToken)
  const profileId = asTrimmedString(record.profileId)

  const lastRefreshAt =
    typeof record.lastRefreshAt === 'number' &&
    Number.isFinite(record.lastRefreshAt)
      ? record.lastRefreshAt
      : undefined
  const lastRefreshFailureAt =
    typeof record.lastRefreshFailureAt === 'number' &&
    Number.isFinite(record.lastRefreshFailureAt)
      ? record.lastRefreshFailureAt
      : undefined

  return {
    apiKey,
    accessToken,
    refreshToken,
    idToken,
    accountId,
    profileId,
    lastRefreshAt,
    lastRefreshFailureAt,
  }
}

function shouldRefreshCodexToken(blob: CodexCredentialBlob): boolean {
  const expiresAt =
    parseJwtExpiryMs(blob.accessToken) ?? parseJwtExpiryMs(blob.idToken)
  if (expiresAt === undefined) {
    return false
  }
  return expiresAt <= Date.now() + CODEX_TOKEN_REFRESH_SKEW_MS
}

function isWithinRefreshFailureCooldown(
  blob: CodexCredentialBlob,
  now = Date.now(),
): boolean {
  const lastRefreshFailureAt = Math.max(
    blob.lastRefreshFailureAt ?? 0,
    inMemoryLastRefreshFailureAt ?? 0,
  )

  if (!lastRefreshFailureAt) {
    return false
  }

  return (
    now - lastRefreshFailureAt < CODEX_TOKEN_REFRESH_RETRY_COOLDOWN_MS
  )
}

function getRefreshErrorMessage(
  status: number,
  bodyText: string,
): string {
  if (!bodyText.trim()) {
    return `Codex token refresh failed with status ${status}.`
  }

  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    const nestedError =
      parsed.error && typeof parsed.error === 'object'
        ? (parsed.error as Record<string, unknown>)
        : undefined
    const code = asTrimmedString(nestedError?.code ?? parsed.code)
    const message =
      asTrimmedString(nestedError?.message ?? parsed.error_description) ??
      bodyText.trim()
    return code
      ? `Codex token refresh failed (${code}): ${message}`
      : `Codex token refresh failed with status ${status}: ${message}`
  } catch {
    return `Codex token refresh failed with status ${status}: ${bodyText.trim()}`
  }
}

export function readCodexCredentials(): CodexCredentialBlob | undefined {
  if (isBareMode()) return undefined

  try {
    const data = getCodexSecureStorage().read()
    return normalizeCodexCredentialBlob(data?.codex)
  } catch {
    return undefined
  }
}

export async function readCodexCredentialsAsync(): Promise<
  CodexCredentialBlob | undefined
> {
  if (isBareMode()) return undefined

  try {
    const data = await getCodexSecureStorage().readAsync()
    return normalizeCodexCredentialBlob(data?.codex)
  } catch {
    return undefined
  }
}

export function isCodexRefreshFailureCoolingDown(
  blob: Pick<CodexCredentialBlob, 'lastRefreshFailureAt'>,
  now = Date.now(),
): boolean {
  return isWithinRefreshFailureCooldown(
    blob as CodexCredentialBlob,
    now,
  )
}

export function saveCodexCredentials(
  credentials: CodexCredentialBlob,
): { success: boolean; warning?: string } {
  if (isBareMode()) {
    return { success: false, warning: 'Bare mode: secure storage is disabled.' }
  }

  const normalized = normalizeCodexCredentialBlob(credentials)
  if (!normalized) {
    return { success: false, warning: 'Codex credentials are incomplete.' }
  }

  const secureStorage = getCodexSecureStorage()
  const previous = secureStorage.read() || {}
  const previousCodex = normalizeCodexCredentialBlob(previous[CODEX_STORAGE_KEY])
  const next = {
    ...(previous as Record<string, unknown>),
    [CODEX_STORAGE_KEY]: {
      ...normalized,
      profileId: normalized.profileId ?? previousCodex?.profileId,
      lastRefreshAt: normalized.lastRefreshAt ?? Date.now(),
    },
  }
  const result = secureStorage.update(next as typeof previous)
  if (result.success) {
    const storedCodex = normalizeCodexCredentialBlob(next[CODEX_STORAGE_KEY])
    inMemoryLastRefreshFailureAt = storedCodex?.lastRefreshFailureAt ?? null
  }
  return result
}

export function attachCodexProfileIdToStoredCredentials(profileId: string): {
  success: boolean
  warning?: string
} {
  if (isBareMode()) {
    return { success: false, warning: 'Bare mode: secure storage is disabled.' }
  }

  const current = readCodexCredentials()
  if (!current) {
    return {
      success: false,
      warning: 'Codex credentials are not stored securely yet.',
    }
  }

  return saveCodexCredentials({
    ...current,
    profileId,
  })
}

function persistCodexRefreshFailure(
  credentials: CodexCredentialBlob,
  occurredAt: number,
): void {
  const result = saveCodexCredentials({
    ...credentials,
    lastRefreshFailureAt: occurredAt,
  })
  if (!result.success) {
    inMemoryLastRefreshFailureAt = occurredAt
  }
}

export function clearCodexCredentials(): {
  success: boolean
  warning?: string
} {
  if (isBareMode()) {
    return { success: true }
  }

  const secureStorage = getCodexSecureStorage()
  const previous = secureStorage.read() || {}
  const next = { ...(previous as Record<string, unknown>) }
  delete next[CODEX_STORAGE_KEY]
  const result = secureStorage.update(next as typeof previous)
  if (result.success) {
    inMemoryLastRefreshFailureAt = null
  }
  return result
}

export async function refreshCodexAccessTokenIfNeeded(options?: {
  force?: boolean
}): Promise<{
  refreshed: boolean
  credentials?: CodexCredentialBlob
}> {
  if (isBareMode()) {
    return { refreshed: false }
  }

  if (process.env.CODEX_API_KEY?.trim()) {
    return { refreshed: false }
  }

  const current = await readCodexCredentialsAsync()
  if (!current) {
    return { refreshed: false }
  }

  if (!current.refreshToken) {
    return { refreshed: false, credentials: current }
  }

  if (!options?.force && !shouldRefreshCodexToken(current)) {
    return { refreshed: false, credentials: current }
  }

  if (!options?.force && isWithinRefreshFailureCooldown(current)) {
    return { refreshed: false, credentials: current }
  }

  if (inFlightCodexRefresh) {
    return inFlightCodexRefresh
  }

  inFlightCodexRefresh = (async () => {
    const refreshAttemptedAt = Date.now()

    try {
      // Cross-process lock: serialize the refresh across clpzcode instances so
      // a concurrent process can't invalidate our rotated refresh token. The
      // network refresh runs INSIDE the lock (locking only the save would still
      // let two processes refresh concurrently and rotate each other's token).
      const locked = await withCredentialRefreshLock(async () => {
        // Re-read under the lock: a sibling may have refreshed between our
        // staleness check above and acquiring the lock (race resolved) — adopt
        // its result and its freshly-rotated refresh token.
        const base = (await readCodexCredentialsAsync()) ?? current
        if (
          !options?.force &&
          base.refreshToken &&
          !shouldRefreshCodexToken(base)
        ) {
          return { refreshed: false as const, credentials: base }
        }
        const refreshToken = base.refreshToken ?? current.refreshToken

        const body = new URLSearchParams({
          client_id: getCodexOAuthClientId(),
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        } as Record<string, string>)

        const { signal, cleanup } = createCombinedAbortSignal(undefined, {
          timeoutMs: 15_000,
        })
        let payload: CodexTokenRefreshResponse
        try {
          const response = await fetch(CODEX_REFRESH_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
            signal,
          })

          if (!response.ok) {
            const bodyText = await response.text().catch(() => '')
            throw new Error(getRefreshErrorMessage(response.status, bodyText))
          }

          payload = (await response.json()) as CodexTokenRefreshResponse
        } finally {
          cleanup()
        }
        const accessToken = asTrimmedString(payload.access_token)
        if (!accessToken) {
          throw new Error(
            'Codex token refresh succeeded without a new access token.',
          )
        }

        const next: CodexCredentialBlob = {
          accessToken,
          refreshToken:
            asTrimmedString(payload.refresh_token) ?? refreshToken,
          idToken: asTrimmedString(payload.id_token) ?? base.idToken,
          accountId:
            parseChatgptAccountId(payload.id_token) ??
            parseChatgptAccountId(payload.access_token) ??
            base.accountId,
          lastRefreshAt: Date.now(),
        }

        const idTokenForExchange = next.idToken ?? base.idToken
        if (idTokenForExchange) {
          next.apiKey = await exchangeCodexIdTokenForApiKey(
            idTokenForExchange,
          ).catch(() => undefined)
        }

        const saveResult = saveCodexCredentials(next)
        if (!saveResult.success) {
          throw new Error(
            saveResult.warning ??
              'Codex token refresh succeeded but credentials could not be saved.',
          )
        }

        return { refreshed: true as const, credentials: next }
      })

      if (locked.acquired) {
        return locked.result
      }
      // Lock contended (a sibling is mid-refresh). Re-read: it likely rotated
      // the token — adopt that rather than racing with our now-stale one.
      const after = await readCodexCredentialsAsync()
      if (after && after.refreshToken && !shouldRefreshCodexToken(after)) {
        return { refreshed: false, credentials: after }
      }
      return { refreshed: false, credentials: current }
    } catch (error) {
      // Re-read the freshest blob before persisting the failure marker, so a
      // sibling process's just-rotated refresh token isn't clobbered by our
      // now-stale `current` (persist replaces the whole blob).
      const latest = await readCodexCredentialsAsync().catch(() => undefined)
      persistCodexRefreshFailure(latest ?? current, refreshAttemptedAt)
      throw error
    } finally {
      inFlightCodexRefresh = null
    }
  })()

  return inFlightCodexRefresh
}
