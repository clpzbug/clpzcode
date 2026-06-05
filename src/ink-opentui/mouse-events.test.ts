import { describe, expect, test } from 'bun:test'
import type { Renderable, MouseEvent as OpenTuiMouseEvent } from '@opentui/core'
import { wireBoxEvents, type BoxEventProps } from './focus-events.js'

// wireBoxEvents synthesizes onClick from a down→up pair on the same renderable (no
// intervening drag) and maps onMouseEnter/Leave from onMouseOver/Out. The synthesis is
// pure closure state, so a bare {} renderable stand-in exercises it (matches the
// keydown-dispatch.test.ts minimal-mock pattern).
const node = () => ({}) as unknown as Renderable
const mouse = (button: number): OpenTuiMouseEvent =>
  ({ button, x: 5, y: 3 }) as unknown as OpenTuiMouseEvent

function wire(props: BoxEventProps) {
  const { boxProps, onRef } = wireBoxEvents(props)
  onRef(node())
  return boxProps as {
    onMouseDown?: (e: OpenTuiMouseEvent) => void
    onMouseUp?: (e: OpenTuiMouseEvent) => void
    onMouseDrag?: () => void
    onMouseOver?: () => void
    onMouseOut?: () => void
  }
}

describe('OpenTUI Box mouse events (wireBoxEvents synthesis)', () => {
  test('left down→up with no drag fires onClick once', () => {
    let clicks = 0
    const b = wire({ onClick: () => clicks++ })
    b.onMouseDown?.(mouse(0))
    b.onMouseUp?.(mouse(0))
    expect(clicks).toBe(1)
  })

  test('a drag between down and up suppresses onClick', () => {
    let clicks = 0
    const b = wire({ onClick: () => clicks++ })
    b.onMouseDown?.(mouse(0))
    b.onMouseDrag?.()
    b.onMouseUp?.(mouse(0))
    expect(clicks).toBe(0)
  })

  test('a re-render between mouse-down and mouse-up still fires onClick', () => {
    // Regression: press state is keyed on the renderable, not the per-render
    // wireBoxEvents closure. A re-render lands a NEW closure between down and up;
    // the click must still fire because the renderable (this) is stable.
    let clicks = 0
    const onClick = () => clicks++
    const r = node() // the stable renderable across re-renders
    const render1 = wireBoxEvents({ onClick }).boxProps as {
      onMouseDown: (this: Renderable, e: OpenTuiMouseEvent) => void
    }
    render1.onMouseDown.call(r, mouse(0))
    const render2 = wireBoxEvents({ onClick }).boxProps as {
      onMouseUp: (this: Renderable, e: OpenTuiMouseEvent) => void
    }
    render2.onMouseUp.call(r, mouse(0))
    expect(clicks).toBe(1)
  })

  test('non-left button does not fire onClick', () => {
    let clicks = 0
    const b = wire({ onClick: () => clicks++ })
    b.onMouseDown?.(mouse(1))
    b.onMouseUp?.(mouse(1))
    expect(clicks).toBe(0)
  })

  test('onMouseEnter/onMouseLeave fire via onMouseOver/onMouseOut', () => {
    let entered = false
    let left = false
    const b = wire({ onMouseEnter: () => (entered = true), onMouseLeave: () => (left = true) })
    b.onMouseOver?.()
    expect(entered).toBe(true)
    b.onMouseOut?.()
    expect(left).toBe(true)
  })
})
