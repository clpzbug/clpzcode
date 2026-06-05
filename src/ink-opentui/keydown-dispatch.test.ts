import { describe, expect, test } from 'bun:test'
import type { Renderable } from '@opentui/core'
import { KeyboardEvent } from '../ink/events/keyboard-event.js'
import type { ParsedKey } from '../ink/parse-keypress.js'
import { dispatchKeydown, setKeyHandlers } from './focus-events.js'

// Minimal Renderable stand-in: dispatchKeydown only walks `.parent` and keys the
// WeakMap by node identity, so a plain {parent} object exercises the real path.
function node(parent: Renderable | null = null): Renderable {
  return { parent } as unknown as Renderable
}

function key(name: string): KeyboardEvent {
  const parsed: ParsedKey = {
    kind: 'key',
    name,
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: name.length === 1 ? name : '\x1b',
    raw: name,
    isPasted: false,
  }
  return new KeyboardEvent(parsed)
}

describe('dispatchKeydown (OpenTUI onKeyDown bubble)', () => {
  test('fires capture root→target then bubble target→root', () => {
    const root = node()
    const mid = node(root)
    const target = node(mid)
    const order: string[] = []
    setKeyHandlers(root, {
      onKeyDownCapture: () => order.push('root-cap'),
      onKeyDown: () => order.push('root-bub'),
    })
    setKeyHandlers(mid, {
      onKeyDownCapture: () => order.push('mid-cap'),
      onKeyDown: () => order.push('mid-bub'),
    })
    setKeyHandlers(target, {
      onKeyDownCapture: () => order.push('target-cap'),
      onKeyDown: () => order.push('target-bub'),
    })

    const ok = dispatchKeydown(target, key('a'))

    expect(order).toEqual([
      'root-cap',
      'mid-cap',
      'target-cap',
      'target-bub',
      'mid-bub',
      'root-bub',
    ])
    expect(ok).toBe(true)
  })

  test('a bubbling handler that does not stop reaches every ancestor', () => {
    const root = node()
    const target = node(root)
    let rootSaw = false
    setKeyHandlers(root, { onKeyDown: () => (rootSaw = true) })
    setKeyHandlers(target, { onKeyDown: () => {} })
    dispatchKeydown(target, key('x'))
    expect(rootSaw).toBe(true)
  })

  test('stopPropagation halts the bubble at the node boundary', () => {
    const root = node()
    const target = node(root)
    let rootSaw = false
    setKeyHandlers(root, { onKeyDown: () => (rootSaw = true) })
    setKeyHandlers(target, { onKeyDown: e => e.stopPropagation() })
    dispatchKeydown(target, key('x'))
    expect(rootSaw).toBe(false)
  })

  test('preventDefault makes dispatch return false (gates Tab cycling)', () => {
    const target = node()
    setKeyHandlers(target, { onKeyDown: e => e.preventDefault() })
    const ok = dispatchKeydown(target, key('tab'))
    expect(ok).toBe(false)
  })

  test('no registered handlers is a no-op returning true', () => {
    const target = node(node())
    expect(dispatchKeydown(target, key('a'))).toBe(true)
  })
})
