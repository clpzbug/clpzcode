// src/utils/theme.opencode.test.ts
//
// Guards the opencode design-port theme foundation: the new opencode-parity
// roles exist on EVERY theme, and the "opencode" theme carries the signature
// warm-orange accent + near-black surfaces + first-class diff colors.
import { describe, expect, test } from 'bun:test'
import { getTheme, THEME_NAMES, type Theme } from './theme.js'

const NEW_ROLES: (keyof Theme)[] = [
  'backgroundPanel',
  'backgroundElement',
  'border',
  'borderActive',
  'selectedListItemText',
  'diffLineNumber',
  'diffHunkHeader',
]

describe('opencode theme port', () => {
  test('opencode theme = warm-orange accent + near-black surfaces + first-class diff', () => {
    const t = getTheme('opencode')
    expect(t.claude).toBe('rgb(180,155,230)') // opencode pastel purple accent
    expect(t.clawd_background).toBe('transparent') // clawd mascot art neutralized (minimal)
    expect(t.backgroundPanel).toBe('rgb(22,22,24)') // non-linear depth ramp (bigger canvas→panel jump)
    expect(t.backgroundElement).toBe('rgb(28,28,31)')
    expect(t.diffAddedWord).toBe('rgb(184,219,135)') // diffHighlightAdded
  })

  test('every theme defines the new opencode-parity roles (non-empty)', () => {
    for (const name of THEME_NAMES) {
      const t = getTheme(name)
      for (const role of NEW_ROLES) {
        expect(t[role], `${name}.${String(role)} must be set`).toBeTruthy()
      }
    }
  })

  test('"opencode" is a selectable theme', () => {
    expect(THEME_NAMES).toContain('opencode')
  })
})
