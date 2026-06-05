// Tests for the centered modal card's geometry (T5). The card itself uses
// position:absolute, which renderToString cannot render — but the SIZING math
// is the real failure mode (wrong inner size → content clips/overflows), so we
// unit-test the pure computeCardLayout. Visual placement/opacity is validated
// in a real terminal (fullscreen mode).
import { describe, expect, it } from 'bun:test'
import { computeCardLayout } from './CenteredModal.js'

describe('computeCardLayout', () => {
  it('caps the card width at 88 on a wide terminal', () => {
    const l = computeCardLayout(160, 50)
    expect(l.cardWidth).toBe(88)
    expect(l.innerColumns).toBe(82) // 88 - border(2) - paddingX(4)
  })

  it('uses columns-4 on a narrower terminal (margin each side, below the cap)', () => {
    const l = computeCardLayout(80, 50)
    expect(l.cardWidth).toBe(76) // 80 - 4 (< 88 cap)
    expect(l.innerColumns).toBe(70) // 76 - border(2) - paddingX(4)
  })

  it('biases the card to the upper-middle (paddingTop ~ rows/4)', () => {
    expect(computeCardLayout(120, 40).paddingTop).toBe(10)
    expect(computeCardLayout(120, 50).paddingTop).toBe(12)
  })

  it('bounds the card height below the screen and keeps inner sizes positive', () => {
    const l = computeCardLayout(120, 40)
    // cardMaxHeight = rows - paddingTop - 2 = 40 - 10 - 2 = 28
    expect(l.cardMaxHeight).toBe(28)
    expect(l.innerRows).toBe(26) // - border(2)
    expect(l.innerRows).toBeGreaterThan(0)
    expect(l.innerColumns).toBeGreaterThan(0)
  })

  it('never produces non-positive inner sizes on a tiny terminal', () => {
    const l = computeCardLayout(10, 6)
    expect(l.innerColumns).toBeGreaterThanOrEqual(1)
    expect(l.innerRows).toBeGreaterThanOrEqual(1)
    expect(l.cardMaxHeight).toBeGreaterThanOrEqual(3)
  })
})
