// src/tui/design/glyphs.test.ts
//
// Guards the per-tool icon table + status-dot semantic roles (opencode-port
// "one-glyph-per-tool, state-by-color" discipline).
import { describe, expect, test } from 'bun:test'
import {
  statusDotRole,
  TOOL_ICON,
  toolGlyph,
  toolGlyphRole,
  toolIcon,
} from './glyphs.js'

describe('per-tool icons', () => {
  test('maps common tools to their glyph (case-insensitive)', () => {
    expect(toolIcon('Bash')).toBe('⚙')
    expect(toolIcon('Read')).toBe('→')
    expect(toolIcon('Write')).toBe('←')
    expect(toolIcon('Edit')).toBe('✎')
    expect(toolIcon('MultiEdit')).toBe('✎')
    expect(toolIcon('Grep')).toBe('✦')
    expect(toolIcon('WebFetch')).toBe('◇')
    expect(toolIcon('Task')).toBe('▢')
  })

  test('unknown tools fall back to the neutral dot', () => {
    expect(toolIcon('SomeRandomMcpTool')).toBe(TOOL_ICON.default)
  })
})

describe('status dots', () => {
  test('map to the right semantic color role', () => {
    expect(statusDotRole('connected')).toBe('signalOk')
    expect(statusDotRole('failed')).toBe('signalError')
    expect(statusDotRole('needsAuth')).toBe('signalWarn')
    expect(statusDotRole('disabled')).toBe('faint')
  })
})

describe('tool-state glyphs', () => {
  test('only the active state gets the accent role; the rest are muted', () => {
    expect(toolGlyphRole('active')).toBe('accent')
    expect(toolGlyphRole('done')).toBe('muted')
    expect(toolGlyphRole('pending')).toBe('muted')
  })

  test('every tool state resolves to a non-empty glyph', () => {
    for (const state of ['active', 'done', 'pending'] as const) {
      expect(toolGlyph(state).length).toBeGreaterThan(0)
    }
  })
})
