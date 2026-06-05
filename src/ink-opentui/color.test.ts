// Guards toOpenTuiColor, the adapter's normalizer that prevents clpzcode's
// rgb()/ansi256()/ansi: Color forms from hitting OpenTUI's magenta hex-fallback
// (issue #17). Every Color reaching a <box>/<text> intrinsic flows through here.
import { describe, expect, test } from 'bun:test'
import type { Color } from '../ink/styles.js'
import { ANSI_16_HEX, toOpenTuiColor } from './color.js'

// Cast at the seam so the tests can pass raw strings (incl. malformed inputs and
// non-Color expected values) without fighting the strict Color template union.
const run = (s: string | undefined): string | undefined =>
  toOpenTuiColor(s as unknown as Color) as string | undefined

describe('toOpenTuiColor', () => {
  test('passes #hex through unchanged', () => {
    expect(run('#0a141e')).toBe('#0a141e')
    expect(run('#abc')).toBe('#abc')
  })

  test('converts rgb(r,g,b) → #rrggbb (zero-padded)', () => {
    expect(run('rgb(10,20,30)')).toBe('#0a141e')
    expect(run('rgb(250,178,131)')).toBe('#fab283')
    expect(run('rgb(0,0,0)')).toBe('#000000')
    expect(run('rgb( 1, 2, 3 )')).toBe('#010203') // optional space after '(' / commas
  })

  test('converts ansi256(n): system / cube / grayscale', () => {
    expect(run('ansi256(0)')).toBe('#000000') // system black
    expect(run('ansi256(15)')).toBe('#ffffff') // whiteBright
    expect(run('ansi256(16)')).toBe('#000000') // cube (0,0,0)
    expect(run('ansi256(196)')).toBe('#ff0000') // cube (5,0,0)
    expect(run('ansi256(231)')).toBe('#ffffff') // cube (5,5,5)
    expect(run('ansi256(232)')).toBe('#080808') // grayscale start
    expect(run('ansi256(255)')).toBe('#eeeeee') // grayscale end
  })

  test('converts ansi:name using the xterm palette (not VGA)', () => {
    expect(run('ansi:red')).toBe('#cd0000') // xterm, NOT VGA #800000
    expect(run('ansi:cyan')).toBe('#00cdcd')
    expect(run('ansi:whiteBright')).toBe('#ffffff')
    expect(run('ansi:red')).toBe(ANSI_16_HEX.red)
  })

  test('returns unrecognized / undefined input unchanged', () => {
    expect(run(undefined)).toBeUndefined()
    expect(run('notacolor')).toBe('notacolor')
    expect(run('ansi:bogus')).toBe('ansi:bogus') // unknown name → as-is
    expect(run('rgb(bad)')).toBe('rgb(bad)') // malformed → as-is
  })
})
