import { describe, expect, test } from 'bun:test'
import { chordActionLabel, chordContinuations } from './chordContinuations.js'
import { parseChord, parseKeystroke } from './parser.js'
import type { ParsedBinding } from './types.js'

function binding(chord: string, action: string | null, context: ParsedBinding['context'] = 'Global'): ParsedBinding {
  return { chord: parseChord(chord), action, context }
}

describe('chordContinuations', () => {
  const bindings: ParsedBinding[] = [
    binding('ctrl+x ctrl+k', 'agent:killAll'),
    binding('ctrl+x ctrl+e', 'editor:external'),
    binding('ctrl+c', 'app:interrupt'),
    binding('ctrl+x ctrl+s', 'session:save', 'Transcript'), // context-gated
    binding('ctrl+x ctrl+z', null), // no action — ignored
  ]

  test('lists next keystrokes that extend the pending prefix (Global only)', () => {
    const conts = chordContinuations([parseKeystroke('ctrl+x')], bindings, new Set(['Global']))
    expect(conts).toEqual([
      { nextKey: 'ctrl+k', action: 'agent:killAll' },
      { nextKey: 'ctrl+e', action: 'editor:external' },
    ])
    // ctrl+c (doesn't extend ctrl+x), the Repl-context one, and the null one are excluded.
  })

  test('includes a context-gated binding only when its context is active', () => {
    const conts = chordContinuations(
      [parseKeystroke('ctrl+x')],
      bindings,
      new Set(['Global', 'Transcript']),
    )
    expect(conts.map(c => c.action)).toContain('session:save')
  })

  test('dedupes identical (nextKey, action) pairs', () => {
    const dup = [binding('ctrl+x ctrl+k', 'agent:killAll'), binding('ctrl+x ctrl+k', 'agent:killAll')]
    const conts = chordContinuations([parseKeystroke('ctrl+x')], dup, new Set(['Global']))
    expect(conts).toHaveLength(1)
  })

  test('returns nothing when no binding extends the prefix', () => {
    const conts = chordContinuations([parseKeystroke('ctrl+q')], bindings, new Set(['Global']))
    expect(conts).toEqual([])
  })
})

describe('chordActionLabel', () => {
  test('takes the segment after the last colon', () => {
    expect(chordActionLabel('agent:killAll')).toBe('killAll')
    expect(chordActionLabel('plain')).toBe('plain')
  })
})
