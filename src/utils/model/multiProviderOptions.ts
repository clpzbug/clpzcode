import { MODEL_DESCRIPTORS } from '../../integrations/generated/integrationArtifacts.generated.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { readXaiCredentials, resolveXaiAccessToken } from '../xaiCredentials.js'
import { buildRouteCatalogModelOptions } from './routeCatalogOptions.js'
import type { ModelOption } from './modelOptions.js'

const XAI_BASE_URL = 'https://api.x.ai/v1'

// Models that are not useful for chat/code (image/video generation)
const XAI_SKIP_PATTERNS = ['imagine', 'image', 'video']

let cachedXaiApiModels: ModelOption[] | null = null

// Outcome of prefetchXaiModels(). 'auth' = the stored session was rejected even
// after a refresh attempt (re-login required); 'network' = a transient failure
// (offline / VPN); 'none' = no stored credentials.
export type XaiPrefetchStatus = 'ok' | 'auth' | 'network' | 'none'
let inFlightXaiPrefetch: Promise<XaiPrefetchStatus> | null = null

// Fetch the full model list from the xAI API and cache it. Called at startup and
// on /model refresh. Returns a status so the UI can prompt for re-login on an
// auth failure instead of silently falling back to the static grok-4.3 list.
// Concurrent callers share one in-flight request.
export async function prefetchXaiModels(): Promise<XaiPrefetchStatus> {
  if (inFlightXaiPrefetch) return inFlightXaiPrefetch
  inFlightXaiPrefetch = (async (): Promise<XaiPrefetchStatus> => {
    try {
      // resolveXaiAccessToken() refreshes an expired / near-expiry token before
      // use. readXaiCredentialsAsync() only READS storage (no refresh), so once
      // the 6h access token lapsed, /v1/models returned 403 and the live list
      // silently fell back to the static grok-4.3 — hiding every other model.
      const accessToken = await resolveXaiAccessToken()
      if (!accessToken) return 'none'

      const { signal, cleanup } = createCombinedAbortSignal(undefined, { timeoutMs: 5000 })
      let response: Response
      try {
        response = await fetch(`${XAI_BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal,
        })
      } finally {
        cleanup()
      }
      // 401/403 means even a freshly-refreshed token is rejected — the session
      // has lapsed and the user must re-login. Distinguish it from a transient
      // network failure so the boot check only nags when action is needed.
      if (response.status === 401 || response.status === 403) return 'auth'
      if (!response.ok) return 'network'

      const data = (await response.json()) as { data?: Array<{ id: string }> }
      const models = data.data
      if (models?.length) {
        cachedXaiApiModels = models
          .map(m => m.id)
          .filter(id => !XAI_SKIP_PATTERNS.some(p => id.includes(p)))
          .map(id => ({
            value: id,
            label: id,
            description: id === 'grok-4.3' ? 'Recommended · Provider: xAI' : 'Provider: xAI',
            descriptionForModel: `Provider: xAI (${id})`,
          }))
      }
      return 'ok'
    } catch {
      return 'network'
    } finally {
      inFlightXaiPrefetch = null
    }
  })()
  return inFlightXaiPrefetch
}

export function getXaiModelOptions(): ModelOption[] | null {
  try {
    const creds = readXaiCredentials()
    if (!creds?.accessToken) return null
  } catch {
    return null
  }

  // Prefer live API model list when available
  if (cachedXaiApiModels) return cachedXaiApiModels

  // Static fallback while prefetch is in flight or not yet called
  const xaiEntries = MODEL_DESCRIPTORS
    .filter(m => m.vendorId === 'xai')
    .map(m => ({
      apiName: m.defaultModel,
      label: m.label,
      default: m.defaultModel === 'grok-4.3',
    }))

  if (!xaiEntries.length) return null
  return buildRouteCatalogModelOptions('xAI', xaiEntries as any, 'grok-4.3')
}

export function getVendorForModel(modelId: string | null | undefined): string {
  if (!modelId) return 'anthropic'
  // Check live API models first
  if (cachedXaiApiModels?.some(o => o.value === modelId)) return 'xai'
  const desc = MODEL_DESCRIPTORS.find(d => d.defaultModel === modelId)
  if (desc?.vendorId) return desc.vendorId
  // The xAI route descriptor carries no concrete grok ids, so a grok-* id is
  // otherwise misclassified as 'anthropic' until the async /models prefetch
  // populates cachedXaiApiModels (and would then be misrouted to Anthropic).
  // Treat a grok id as xAI whenever xAI creds are present.
  if (/^(x-ai\/|xai\/)?grok[-.]/i.test(modelId)) {
    try {
      if (readXaiCredentials()?.accessToken) return 'xai'
    } catch {
      /* fall through to anthropic */
    }
  }
  return 'anthropic'
}

/**
 * Build a per-request provider override for a sub-agent whose target model is an
 * OpenAI-compatible vendor (xAI/Grok). Routing through this override (baseURL +
 * token) instead of the process-global provider env is what lets a Grok
 * sub-agent run IN PARALLEL with an Anthropic main loop without the two racing
 * on process.env. Returns null for Anthropic-native models — those carry the
 * model in the request body and are already safe to parallelize.
 */
export async function buildProviderOverrideForModel(
  modelId: string | null | undefined,
): Promise<{ model: string; baseURL: string; apiKey: string } | null> {
  if (!modelId || getVendorForModel(modelId) !== 'xai') return null
  try {
    const accessToken = await resolveXaiAccessToken()
    if (!accessToken) return null
    return { model: modelId, baseURL: XAI_BASE_URL, apiKey: accessToken }
  } catch {
    // Token resolution failed — fall back to the ambient routing rather than
    // breaking the spawn (no worse than the prior behavior).
    return null
  }
}

export function switchProviderEnvForModel(modelId: string | null | undefined): void {
  const vendor = getVendorForModel(modelId)

  if (vendor === 'xai') {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = XAI_BASE_URL
    process.env.OPENAI_MODEL = modelId ?? 'grok-4.3'
    // openaiShim.ts resolves the OAuth token automatically when OPENAI_API_KEY is absent
    delete process.env.OPENAI_API_KEY
    // Clear any custom-header/format routing a previous provider left behind, or
    // the xAI OAuth Bearer would be injected into a stale custom header (401/403).
    delete process.env.OPENAI_API_FORMAT
    delete process.env.OPENAI_AUTH_HEADER
    delete process.env.OPENAI_AUTH_SCHEME
    delete process.env.OPENAI_AUTH_HEADER_VALUE
  } else {
    // Anthropic: clear all OpenAI-compat routing flags
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_FORMAT
    delete process.env.OPENAI_AUTH_HEADER
    delete process.env.OPENAI_AUTH_SCHEME
    delete process.env.OPENAI_AUTH_HEADER_VALUE
    // An explicit Anthropic selection must win over a stray xAI key whose mere
    // presence would otherwise re-route the request to xAI (env-only intent).
    delete process.env.XAI_API_KEY
  }
}
