import { describe, expect, it } from 'bun:test'
import { getTheme, THEME_NAMES, type ThemeName } from './theme.js'

// Locks the canvasBackground role added when the forced dark canvas was removed:
// the canvas fill is decoupled from theme.background, dark themes go transparent
// (terminal shows through), light themes keep their fill. TS guarantees the field
// exists; these assert the actual values/contract that TS cannot.
describe('theme canvasBackground role', () => {
  const DARK: ThemeName[] = [
    'dark',
    'dark-daltonized',
    'dark-ansi',
    'pentest-dark',
    'opencode',
  ]
  const LIGHT: ThemeName[] = ['light', 'light-daltonized', 'light-ansi']

  it('every theme defines a non-empty canvasBackground', () => {
    for (const name of THEME_NAMES) {
      const cb = getTheme(name).canvasBackground
      expect(typeof cb).toBe('string')
      expect(cb.length).toBeGreaterThan(0)
    }
  })

  it('dark themes use a transparent canvas so the terminal shows through', () => {
    for (const name of DARK) {
      expect(getTheme(name).canvasBackground).toBe('transparent')
    }
  })

  it('light themes keep their existing background fill as the canvas', () => {
    for (const name of LIGHT) {
      const t = getTheme(name)
      // light canvas is NOT transparent and matches the palette background.
      expect(t.canvasBackground).not.toBe('transparent')
      expect(t.canvasBackground).toBe(t.background)
    }
  })

  it('canvasBackground is decoupled from background for dark themes (the whole point)', () => {
    // dark themes: canvas transparent while background keeps its opaque fill —
    // proves panels/messages are unaffected by the canvas change.
    for (const name of DARK) {
      const t = getTheme(name)
      expect(t.canvasBackground).not.toBe(t.background)
      expect(t.background.length).toBeGreaterThan(0)
    }
  })

  it('THEME_NAMES is fully partitioned into the dark/light sets under test', () => {
    // Guards against a future theme being added without canvasBackground coverage.
    const covered = new Set<ThemeName>([...DARK, ...LIGHT])
    for (const name of THEME_NAMES) expect(covered.has(name)).toBe(true)
    expect(covered.size).toBe(THEME_NAMES.length)
  })
})
