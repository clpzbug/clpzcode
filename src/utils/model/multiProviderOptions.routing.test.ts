import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readXaiCredentials } from '../xaiCredentials.js'
import { getVendorForModel, switchProviderEnvForModel } from './multiProviderOptions.js'

// The grok-routing assertions depend on xAI creds being present (the vendor
// heuristic only treats a grok id as xAI when logged in). Gate them on the real
// credential state so the test is deterministic on a logged-in dev machine and
// simply skips where xAI is not connected.
let loggedIn = false
try {
  loggedIn = !!readXaiCredentials()?.accessToken
} catch {
  loggedIn = false
}

const ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_API_FORMAT',
  'OPENAI_AUTH_HEADER',
  'OPENAI_AUTH_SCHEME',
  'OPENAI_AUTH_HEADER_VALUE',
  'XAI_API_KEY',
]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

// --- creds-independent (always run) ---------------------------------------

test('getVendorForModel: claude models are anthropic', () => {
  expect(getVendorForModel('claude-sonnet-4-6')).toBe('anthropic')
  expect(getVendorForModel('claude-opus-4-8')).toBe('anthropic')
})

test('switchProviderEnvForModel: anthropic selection clears OpenAI routing, stale headers, and a stray XAI_API_KEY', () => {
  // Simulate a previous OpenAI-compat/custom-header session + a stray ambient key.
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.x.ai/v1'
  process.env.OPENAI_MODEL = 'grok-4.3'
  process.env.OPENAI_AUTH_HEADER = 'X-Custom-Auth'
  process.env.OPENAI_AUTH_HEADER_VALUE = 'leftover'
  process.env.XAI_API_KEY = 'xai-ambient-key'

  switchProviderEnvForModel('claude-sonnet-4-6')

  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  expect(process.env.OPENAI_BASE_URL).toBeUndefined()
  expect(process.env.OPENAI_MODEL).toBeUndefined()
  expect(process.env.OPENAI_AUTH_HEADER).toBeUndefined()
  expect(process.env.OPENAI_AUTH_HEADER_VALUE).toBeUndefined()
  expect(process.env.XAI_API_KEY).toBeUndefined()
})

// --- grok routing (requires xAI login) ------------------------------------

test.skipIf(!loggedIn)('getVendorForModel: grok ids route to xai when logged in (even before prefetch)', () => {
  expect(getVendorForModel('grok-4.3')).toBe('xai')
  expect(getVendorForModel('grok-4.20-0309-reasoning')).toBe('xai')
  expect(getVendorForModel('x-ai/grok-4.3')).toBe('xai')
})

test.skipIf(!loggedIn)('switchProviderEnvForModel: grok selection sets the xAI OpenAI-compat route and clears stale auth headers', () => {
  process.env.OPENAI_AUTH_HEADER = 'X-Custom-Auth'
  switchProviderEnvForModel('grok-4.3')
  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  expect(process.env.OPENAI_BASE_URL).toBe('https://api.x.ai/v1')
  expect(process.env.OPENAI_API_KEY).toBeUndefined() // shim resolves the OAuth token
  expect(process.env.OPENAI_AUTH_HEADER).toBeUndefined()
})

test.skipIf(!loggedIn)('switchProviderEnvForModel: toggling grok -> claude -> grok flips the route each time', () => {
  switchProviderEnvForModel('grok-4.3')
  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  switchProviderEnvForModel('claude-sonnet-4-6')
  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  switchProviderEnvForModel('grok-4.3')
  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
})
