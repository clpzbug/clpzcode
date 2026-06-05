// src/native-ts/color-diff/opencode-diff.test.ts
//
// Guards the opencode diff palette: the "opencode" theme must render a dark
// teal/red diff (mirroring opencode.json) — NOT the light fallback it used to
// hit before buildTheme learned the theme name.
import { describe, expect, test } from 'bun:test'
import { ColorDiff } from './index.js'

const hunk = {
  oldStart: 1,
  oldLines: 2,
  newStart: 1,
  newLines: 2,
  lines: [' const x = 1', '-const y = 2', '+const y = 3'],
}

describe('opencode diff palette', () => {
  test('opencode renders a diff distinct from the light fallback', () => {
    const oc = new ColorDiff(hunk, null, 'x.ts', null).render('opencode', 80, false)
    const light = new ColorDiff(hunk, null, 'x.ts', null).render('light', 80, false)
    expect(oc).not.toBeNull()
    expect(light).not.toBeNull()
    expect(oc!.join('\n')).not.toBe(light!.join('\n'))
  })

  test('opencode added lines carry the teal added-bg truecolor escape (48;2;32;48;59)', () => {
    const oc = new ColorDiff(hunk, null, 'x.ts', null).render('opencode', 80, false)!
    expect(oc.join('\n')).toContain('48;2;32;48;59') // addLine bg = rgb(32,48,59)
  })

  test('opencode deleted lines carry the red deleted-bg truecolor escape (48;2;55;34;44)', () => {
    const oc = new ColorDiff(hunk, null, 'x.ts', null).render('opencode', 80, false)!
    expect(oc.join('\n')).toContain('48;2;55;34;44') // deleteLine bg = rgb(55,34,44)
  })
})
