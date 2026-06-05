import { describe, expect, it } from 'bun:test'
import { buildProviderOverrideForModel } from './multiProviderOptions.js'

describe('buildProviderOverrideForModel', () => {
  it('returns null for Anthropic-native models (they parallelize via the native path)', async () => {
    expect(await buildProviderOverrideForModel('claude-opus-4-8')).toBeNull()
    expect(await buildProviderOverrideForModel('sonnet')).toBeNull()
  })

  it('returns null for empty/undefined model and never throws', async () => {
    expect(await buildProviderOverrideForModel(undefined)).toBeNull()
    expect(await buildProviderOverrideForModel('')).toBeNull()
  })
})
