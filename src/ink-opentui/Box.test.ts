// Guards mapBoxProps — the Ink-Box → OpenTUI <box> prop translation. Covers the
// deltas (border style/sides, display:none, gap fallback, opaque surface) and
// the rank1 passthrough (focusedBorderColor normalization).
import { describe, expect, test } from 'bun:test'
import type { Props as InkBoxProps } from '../ink/components/Box.js'
import { mapBoxProps } from './Box.js'

const map = (p: Partial<InkBoxProps> & Record<string, unknown>) =>
  mapBoxProps(p as InkBoxProps)

describe('mapBoxProps', () => {
  test('borderStyle maps to OpenTUI style + border:true when all sides on', () => {
    const out = map({ borderStyle: 'round' })
    expect(out.borderStyle).toBe('rounded')
    expect(out.border).toBe(true)
  })

  test('unknown borderStyle falls back to single', () => {
    expect(map({ borderStyle: 'wat' as never }).borderStyle).toBe('single')
  })

  test('a disabled side yields a sides array (not true)', () => {
    const out = map({ borderStyle: 'single', borderTop: false })
    expect(out.border).toEqual(['right', 'bottom', 'left'])
  })

  test('display:none → visible:false', () => {
    expect(map({ display: 'none' }).visible).toBe(false)
    expect(map({}).visible).toBeUndefined()
  })

  test('gap/columnGap/rowGap forward 1:1 (OpenTUI has per-axis gutters)', () => {
    expect(map({ gap: 2 }).gap).toBe(2)
    expect(map({ columnGap: 3 }).columnGap).toBe(3)
    expect(map({ rowGap: 4 }).rowGap).toBe(4)
    const asym = map({ rowGap: 1, columnGap: 3 })
    expect(asym.rowGap).toBe(1)
    expect(asym.columnGap).toBe(3)
    expect(map({}).gap).toBeUndefined()
  })

  test('opaque without backgroundColor stays transparent (no injected surface)', () => {
    // By the owner's design the UI is fully transparent: an opaque overlay sets
    // shouldFill but injects NO fallback color, so the terminal background shows
    // through. OpenTUI treats shouldFill with no color as a no-op fill.
    const out = map({ opaque: true })
    expect(out.shouldFill).toBe(true)
    expect(out.backgroundColor).toBeUndefined()
  })

  test('opaque keeps an explicit backgroundColor (normalized)', () => {
    const out = map({ opaque: true, backgroundColor: 'rgb(10,20,30)' as never })
    expect(out.shouldFill).toBe(true)
    expect(out.backgroundColor).toBe('#0a141e')
  })

  test('focusedBorderColor is normalized like borderColor (rank1 passthrough)', () => {
    expect(map({ focusedBorderColor: 'rgb(250,178,131)' as never }).focusedBorderColor).toBe('#fab283')
  })

  test('boxes are non-selectable so a drag never auto-starts native selection', () => {
    expect(map({}).selectable).toBe(false)
  })
})
