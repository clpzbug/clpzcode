import { describe, expect, test } from 'bun:test'
import ad from './index.js'

describe('/ad command', () => {
  test('has correct name', () => {
    expect(ad.name).toBe('ad')
  })

  test('is a prompt-type command', () => {
    expect(ad.type).toBe('prompt')
  })

  test('has argumentHint with dc_ip and domain', () => {
    expect(ad.argumentHint).toContain('dc_ip')
    expect(ad.argumentHint).toContain('domain')
  })

  test('returns usage when no args provided', async () => {
    const result = await ad.getPromptForCommand('')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('Usage:')
    expect(text).toContain('/ad')
  })

  test('returns usage when only dc_ip provided', async () => {
    const result = await ad.getPromptForCommand('10.10.10.1')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('Usage:')
  })

  test('returns AD pipeline when dc_ip and domain provided', async () => {
    const result = await ad.getPromptForCommand('10.10.10.1 contoso.local')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('contoso.local')
    expect(text).toContain('10.10.10.1')
    expect(text).toContain('ADReconTool')
    expect(text).toContain('ADAttackTool')
  })

  test('includes Kerberoast and ADCS in attack plan', async () => {
    const result = await ad.getPromptForCommand('10.10.10.1 contoso.local')
    const text = (result[0] as { type: string; text: string }).text
    expect(text.toLowerCase()).toContain('kerberoast')
    expect(text.toLowerCase()).toContain('adcs')
    expect(text.toLowerCase()).toContain('dcsync')
  })

  test('includes credentials when provided', async () => {
    const result = await ad.getPromptForCommand('10.10.10.1 contoso.local jdoe Password123')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('jdoe')
    expect(text).toContain('Password123')
  })

  test('EngagementTool appears in pipeline for context storage', async () => {
    const result = await ad.getPromptForCommand('10.10.10.1 corp.local')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('EngagementTool')
  })
})


describe('/ad command — null session (no credentials)', () => {
  test('null session path mentions kerbrute for user enumeration', async () => {
    const result = await ad.getPromptForCommand('10.10.10.1 corp.local')
    const text = (result[0] as { type: string; text: string }).text
    // Without creds, should mention kerbrute for user enumeration
    expect(text.toLowerCase()).toContain('kerbrute')
  })
})
