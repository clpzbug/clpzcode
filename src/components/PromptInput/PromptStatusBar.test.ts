// Guards the prompt status-bar context gauge thresholds: calm < 85 ≤ nudge
// (warm accent, soft "filling up") < 92 ≤ alarm (amber). No calm→alarm cliff;
// a null usage (no API turn yet) reads calm.
import { describe, expect, test } from 'bun:test'
import { gaugeLevel } from './PromptStatusBar.js'

describe('gaugeLevel', () => {
  test('calm below the nudge threshold (incl. fresh/null usage)', () => {
    expect(gaugeLevel(null)).toBe('calm')
    expect(gaugeLevel(0)).toBe('calm')
    expect(gaugeLevel(34)).toBe('calm') // the system-prompt baseline
    expect(gaugeLevel(84)).toBe('calm')
  })

  test('nudge from 85 up to (but not including) 92', () => {
    expect(gaugeLevel(85)).toBe('nudge')
    expect(gaugeLevel(91)).toBe('nudge')
  })

  test('alarm at 92 and above', () => {
    expect(gaugeLevel(92)).toBe('alarm')
    expect(gaugeLevel(100)).toBe('alarm')
  })
})
