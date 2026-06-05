/**
 * Tests for tool result eviction (RAM/context-window hygiene).
 *
 * The pipeline: buildTool() declares maxResultSizeChars → processPreMappedToolResultBlock
 * calls getPersistenceThreshold(toolName, maxResultSizeChars) → maybePersistLargeToolResult
 * replaces oversized content with a file-reference preview.
 *
 * These tests cover:
 *   1. getPersistenceThreshold — clamping and Infinity opt-out
 *   2. isToolResultContentEmpty — empty-content guard
 *   3. generatePreview — newline-aware truncation
 *   4. Source inspection: security tools declare below-default maxResultSizeChars
 *   5. Source inspection: processPreMappedToolResultBlock is used in the pipeline
 */

import { describe, test, expect } from 'bun:test'
import { resolve } from 'path'

const SRC = resolve(import.meta.dir, '..')
const file = (relative: string) => Bun.file(resolve(SRC, relative))

// ---------------------------------------------------------------------------
// 1 — getPersistenceThreshold
// ---------------------------------------------------------------------------

describe('getPersistenceThreshold', () => {
  test('clamps declared limit to DEFAULT_MAX_RESULT_SIZE_CHARS (50_000) when declared is higher', async () => {
    const { getPersistenceThreshold } = await import('../utils/toolResultStorage.js')
    // MultiReadTool declares 500_000, but global cap is 50_000
    expect(getPersistenceThreshold('MultiRead', 500_000)).toBe(50_000)
  })

  test('returns declared limit when it is below the default cap', async () => {
    const { getPersistenceThreshold } = await import('../utils/toolResultStorage.js')
    // NmapTool declares 40_000 (< 50_000 default) → effective threshold is 40_000
    expect(getPersistenceThreshold('Nmap', 40_000)).toBe(40_000)
  })

  test('returns declared limit when equal to default cap', async () => {
    const { getPersistenceThreshold } = await import('../utils/toolResultStorage.js')
    expect(getPersistenceThreshold('SomeTool', 50_000)).toBe(50_000)
  })

  test('returns Infinity unchanged — opt-out for FileReadTool', async () => {
    const { getPersistenceThreshold } = await import('../utils/toolResultStorage.js')
    // FileReadTool declares Infinity so the model can always read full files
    expect(getPersistenceThreshold('FileRead', Infinity)).toBe(Infinity)
  })

  test('security tools have tighter-than-default limits', async () => {
    const { getPersistenceThreshold } = await import('../utils/toolResultStorage.js')
    // Each of these tools was given a per-tool cap below 50k in commit 2fcd351
    expect(getPersistenceThreshold('Nmap', 40_000)).toBeLessThan(50_000)
    expect(getPersistenceThreshold('Fuzz', 40_000)).toBeLessThan(50_000)
    expect(getPersistenceThreshold('SQLi', 25_000)).toBeLessThan(50_000)
    expect(getPersistenceThreshold('HTTP', 25_000)).toBeLessThan(50_000)
    expect(getPersistenceThreshold('ADRecon', 30_000)).toBeLessThan(50_000)
    expect(getPersistenceThreshold('ADAttack', 30_000)).toBeLessThan(50_000)
    expect(getPersistenceThreshold('Spider', 30_000)).toBeLessThan(50_000)
  })
})

// ---------------------------------------------------------------------------
// 2 — isToolResultContentEmpty
// ---------------------------------------------------------------------------

describe('isToolResultContentEmpty', () => {
  test('empty string is empty', async () => {
    const { isToolResultContentEmpty } = await import('../utils/toolResultStorage.js')
    expect(isToolResultContentEmpty('')).toBe(true)
  })

  test('whitespace-only string is empty', async () => {
    const { isToolResultContentEmpty } = await import('../utils/toolResultStorage.js')
    expect(isToolResultContentEmpty('   \n\t  ')).toBe(true)
  })

  test('non-empty string is not empty', async () => {
    const { isToolResultContentEmpty } = await import('../utils/toolResultStorage.js')
    expect(isToolResultContentEmpty('output')).toBe(false)
  })

  test('null/undefined is empty', async () => {
    const { isToolResultContentEmpty } = await import('../utils/toolResultStorage.js')
    expect(isToolResultContentEmpty(undefined)).toBe(true)
    expect(isToolResultContentEmpty(null as never)).toBe(true)
  })

  test('empty array is empty', async () => {
    const { isToolResultContentEmpty } = await import('../utils/toolResultStorage.js')
    expect(isToolResultContentEmpty([])).toBe(true)
  })

  test('array of empty text blocks is empty', async () => {
    const { isToolResultContentEmpty } = await import('../utils/toolResultStorage.js')
    expect(isToolResultContentEmpty([
      { type: 'text', text: '' },
      { type: 'text', text: '   ' },
    ])).toBe(true)
  })

  test('array with content is not empty', async () => {
    const { isToolResultContentEmpty } = await import('../utils/toolResultStorage.js')
    expect(isToolResultContentEmpty([
      { type: 'text', text: 'result output' },
    ])).toBe(false)
  })

  test('array with image block is not empty', async () => {
    const { isToolResultContentEmpty } = await import('../utils/toolResultStorage.js')
    // Image blocks are non-text → not empty (tool produced something)
    expect(isToolResultContentEmpty([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } } as never,
    ])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3 — generatePreview (newline-aware truncation)
// ---------------------------------------------------------------------------

describe('generatePreview', () => {
  test('short content: returns full content, hasMore=false', async () => {
    const { generatePreview } = await import('../utils/toolResultStorage.js')
    const { preview, hasMore } = generatePreview('hello world', 2000)
    expect(preview).toBe('hello world')
    expect(hasMore).toBe(false)
  })

  test('content exactly at limit: returns full content, hasMore=false', async () => {
    const { generatePreview } = await import('../utils/toolResultStorage.js')
    const content = 'x'.repeat(2000)
    const { preview, hasMore } = generatePreview(content, 2000)
    expect(preview).toBe(content)
    expect(hasMore).toBe(false)
  })

  test('content over limit: truncates and hasMore=true', async () => {
    const { generatePreview } = await import('../utils/toolResultStorage.js')
    const content = 'x'.repeat(3000)
    const { preview, hasMore } = generatePreview(content, 2000)
    expect(preview.length).toBeLessThanOrEqual(2000)
    expect(hasMore).toBe(true)
  })

  test('prefers to cut at a newline near the limit', async () => {
    const { generatePreview } = await import('../utils/toolResultStorage.js')
    // Line 1: 150 chars + \n (newline at idx 150, > 50% of limit 200 → triggers newline cut)
    // Line 2: 2000 chars (ensures content is well over limit)
    const line1 = 'a'.repeat(150) + '\n'
    const line2 = 'b'.repeat(2000)
    const { preview, hasMore } = generatePreview(line1 + line2, 200)
    // cutPoint = lastNewline (150) since 150 > 200*0.5 → slice excludes the \n
    expect(preview).toBe('a'.repeat(150))
    expect(hasMore).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4 — Source: security tools declare per-tool maxResultSizeChars limits
// ---------------------------------------------------------------------------

describe('source: per-tool maxResultSizeChars declarations', () => {
  test('NmapTool declares 40_000 (below 50k default)', async () => {
    const content = await file('tools/NmapTool/NmapTool.ts').text()
    expect(content).toContain('maxResultSizeChars: 40_000')
  })

  test('FuzzTool declares 40_000', async () => {
    const content = await file('tools/FuzzTool/FuzzTool.ts').text()
    expect(content).toContain('maxResultSizeChars: 40_000')
  })

  test('SQLiTool declares 25_000', async () => {
    const content = await file('tools/SQLiTool/SQLiTool.ts').text()
    expect(content).toContain('maxResultSizeChars: 25_000')
  })

  test('HTTPTool declares 25_000', async () => {
    const content = await file('tools/HTTPTool/HTTPTool.ts').text()
    expect(content).toContain('maxResultSizeChars: 25_000')
  })

  test('ADReconTool declares 30_000', async () => {
    const content = await file('tools/ADReconTool/ADReconTool.ts').text()
    expect(content).toContain('maxResultSizeChars: 30_000')
  })

  test('ADAttackTool declares 30_000', async () => {
    const content = await file('tools/ADAttackTool/ADAttackTool.ts').text()
    expect(content).toContain('maxResultSizeChars: 30_000')
  })

  test('SpiderTool declares 30_000', async () => {
    const content = await file('tools/SpiderTool/SpiderTool.ts').text()
    expect(content).toContain('maxResultSizeChars: 30_000')
  })

  test('FileReadTool declares Infinity (opt-out — model needs full file access)', async () => {
    const content = await file('tools/FileReadTool/FileReadTool.ts').text()
    expect(content).toContain('maxResultSizeChars: Infinity')
  })
})

// ---------------------------------------------------------------------------
// 5 — Source: pipeline routes tool results through processPreMappedToolResultBlock
// ---------------------------------------------------------------------------

describe('source: eviction pipeline wired into tool dispatch', () => {
  test('processPreMappedToolResultBlock is exported from toolResultStorage', async () => {
    const content = await file('utils/toolResultStorage.ts').text()
    expect(content).toContain('export async function processPreMappedToolResultBlock')
  })

  test('processPreMappedToolResultBlock delegates to getPersistenceThreshold', async () => {
    const content = await file('utils/toolResultStorage.ts').text()
    expect(content).toContain('getPersistenceThreshold(toolName, maxResultSizeChars)')
  })

  test('GrowthBook override flag constant is defined', async () => {
    const content = await file('utils/toolResultStorage.ts').text()
    expect(content).toContain("'tengu_satin_quoll'")
  })

  test('TOOL_RESULT_CLEARED_MESSAGE sentinel is defined for microcompact eviction', async () => {
    const content = await file('utils/toolResultStorage.ts').text()
    expect(content).toContain("TOOL_RESULT_CLEARED_MESSAGE = '[Old tool result content cleared]'")
  })
})
