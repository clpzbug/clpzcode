import { describe, expect, test } from 'bun:test'
import hunt from './index.ts'

describe('/hunt command', () => {
  test('has correct name', () => {
    expect(hunt.name).toBe('hunt')
  })

  test('is a prompt-type command', () => {
    expect(hunt.type).toBe('prompt')
  })

  test('returns usage when no target provided', async () => {
    const result = await hunt.getPromptForCommand('')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('Usage:')
    expect(text).toContain('/hunt')
  })

  test('returns RCE-first pipeline for valid target', async () => {
    const result = await hunt.getPromptForCommand('example.com')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('SSTI')
    expect(text).toContain('SSRF')
    expect(text).toContain('SQLi')
  })

  test('SSTI (3a) comes before SSRF (3b) in Phase 3', async () => {
    const result = await hunt.getPromptForCommand('example.com')
    const text = (result[0] as { type: string; text: string }).text
    const sstiPos = text.indexOf('3a')
    const ssrfPos = text.indexOf('3b')
    expect(sstiPos).toBeLessThan(ssrfPos)
  })

  test('Phase 5 mentions ChainTool for escalation', async () => {
    const result = await hunt.getPromptForCommand('example.com')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('ChainTool')
  })

  test('uses bounty mode by default', async () => {
    const result = await hunt.getPromptForCommand('example.com')
    const text = (result[0] as { type: string; text: string }).text
    expect(text.toLowerCase()).toContain('bounty')
  })

  test('accepts --mode flag for different engagement types', async () => {
    const result = await hunt.getPromptForCommand('example.com --mode red')
    const text = (result[0] as { type: string; text: string }).text
    expect(text.toUpperCase()).toContain('RED')
  })

  test('output includes EngagementTool.add_finding instructions', async () => {
    const result = await hunt.getPromptForCommand('target.com')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('EngagementTool')
    expect(text).toContain('add_finding')
  })
})
