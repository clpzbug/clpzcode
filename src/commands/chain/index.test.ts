import { describe, expect, test } from 'bun:test'
import chain from './index.ts'

describe('/chain command', () => {
  test('has correct name', () => {
    expect(chain.name).toBe('chain')
  })

  test('is a prompt-type command', () => {
    expect(chain.type).toBe('prompt')
  })

  test('returns usage with known classes when no bug-class provided', async () => {
    const result = await chain.getPromptForCommand('')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('Usage:')
    expect(text).toContain('bug-class')
  })

  test('known classes list includes ssti in usage', async () => {
    const result = await chain.getPromptForCommand('')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('ssti')
    expect(text).toContain('ssrf')
    expect(text).toContain('sqli')
  })

  test('generates ChainTool call prompt for ssrf bug class', async () => {
    const result = await chain.getPromptForCommand('ssrf https://target.com/fetch')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('ChainTool')
    expect(text).toContain('ssrf')
    expect(text).toContain('20 minutes')
  })

  test('generates ChainTool call prompt for ssti bug class', async () => {
    const result = await chain.getPromptForCommand('ssti')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('ChainTool')
    expect(text).toContain('ssti')
  })

  test('includes target URL when provided', async () => {
    const result = await chain.getPromptForCommand('xxe https://api.target.com/xml')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('https://api.target.com/xml')
  })

  test('includes success criteria (stop when chain confirmed)', async () => {
    const result = await chain.getPromptForCommand('lfi')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('confirmed')
    expect(text).toContain('20 minutes')
  })
})

describe('/chain command — KNOWN_CLASSES completeness (cycle 4)', () => {
  test('usage text includes all 29 bug classes', async () => {
    const result = await chain.getPromptForCommand('')
    const text = (result[0] as { type: string; text: string }).text
    // Check a sample of the less common classes added in pentest cycles 2–4
    expect(text).toContain('cors-credentialed')
    expect(text).toContain('wordpress')
    expect(text).toContain('csrf')
    expect(text).toContain('xxe')
    expect(text).toContain('subdomain-takeover')
    expect(text).toContain('race-condition')
    expect(text).toContain('zerologon')
  })

  test('generates ChainTool call for wordpress class', async () => {
    const result = await chain.getPromptForCommand('wordpress https://wp.target.com')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('ChainTool')
    expect(text).toContain('wordpress')
  })

  test('generates ChainTool call for race-condition class', async () => {
    const result = await chain.getPromptForCommand('race-condition')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('race-condition')
    expect(text).toContain('20 minutes')
  })
})
