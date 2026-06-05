import { describe, expect, test } from 'bun:test'
import recon from './index.ts'

describe('/recon command', () => {
  test('has correct name', () => {
    expect(recon.name).toBe('recon')
  })

  test('is a prompt-type command', () => {
    expect(recon.type).toBe('prompt')
  })

  test('returns usage when no target provided', async () => {
    const result = await recon.getPromptForCommand('')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('Usage:')
    expect(text).toContain('/recon')
  })

  test('returns 7-stage pipeline for valid target', async () => {
    const result = await recon.getPromptForCommand('example.com')
    const text = (result[0] as { type: string; text: string }).text
    // All 7 stages should be present
    expect(text).toContain('Stage 1')
    expect(text).toContain('Stage 2')
    expect(text).toContain('Stage 6')
    expect(text).toContain('Stage 7')
  })

  test('includes SSTI as highest priority in Stage 4', async () => {
    const result = await recon.getPromptForCommand('target.com')
    const text = (result[0] as { type: string; text: string }).text
    expect(text.toLowerCase()).toContain('ssti')
    // SSTI should come before SSRF in Stage 4 priority list
    const sstiPos = text.toLowerCase().indexOf('ssti')
    const ssrfPos = text.toLowerCase().indexOf('ssrf')
    expect(sstiPos).toBeLessThan(ssrfPos)
  })

  test('Stage 6 includes RCE exploitation (SSTI→RCE chain)', async () => {
    const result = await recon.getPromptForCommand('example.com')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('SSTITool')
    expect(text).toContain('action=exploit')
  })

  test('Stage 7 includes EngagementTool.add_finding', async () => {
    const result = await recon.getPromptForCommand('example.com')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('EngagementTool')
    expect(text).toContain('add_finding')
  })

  test('target domain appears in output directory path', async () => {
    const result = await recon.getPromptForCommand('target.com')
    const text = (result[0] as { type: string; text: string }).text
    expect(text).toContain('target.com')
  })
})
