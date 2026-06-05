import { describe, expect, test } from 'bun:test'
import { getNextPermissionMode } from '../utils/permissions/getNextPermissionMode.js'
import { getEmptyToolPermissionContext, type ToolPermissionContext } from '../Tool.js'

// Builds a context overriding only the fields the cycle reads.
const ctx = (over: Partial<{ mode: string; isBypassPermissionsModeAvailable: boolean }>) =>
  ({ ...getEmptyToolPermissionContext(), ...over } as unknown as ToolPermissionContext)

// These expectations characterize the EXTERNAL (non-ant) build, which is what
// this open-source fork ships: USER_TYPE is unset, and TRANSCRIPT_CLASSIFIER /
// auto mode are off, so canCycleToAuto() is always false. Auto/ant branches are
// dead code here and intentionally NOT asserted.

describe('getNextPermissionMode — Shift+Tab cycle (external build)', () => {
  test('default -> acceptEdits', () => {
    expect(getNextPermissionMode(ctx({ mode: 'default' }))).toBe('acceptEdits')
  })

  test('acceptEdits -> plan', () => {
    expect(getNextPermissionMode(ctx({ mode: 'acceptEdits' }))).toBe('plan')
  })

  test('plan -> default when bypass unavailable', () => {
    expect(getNextPermissionMode(ctx({ mode: 'plan' }))).toBe('default')
  })

  test('plan -> bypassPermissions when bypass IS available', () => {
    expect(
      getNextPermissionMode(ctx({ mode: 'plan', isBypassPermissionsModeAvailable: true })),
    ).toBe('bypassPermissions')
  })

  test('bypassPermissions -> default', () => {
    expect(getNextPermissionMode(ctx({ mode: 'bypassPermissions' }))).toBe('default')
  })

  test('dontAsk -> default (not exposed in UI cycle)', () => {
    expect(getNextPermissionMode(ctx({ mode: 'dontAsk' }))).toBe('default')
  })

  test('full cycle returns to default within 3 steps when bypass unavailable', () => {
    let mode = 'default'
    const seen: string[] = [mode]
    for (let i = 0; i < 3; i++) {
      mode = getNextPermissionMode(ctx({ mode }))
      seen.push(mode)
    }
    // default -> acceptEdits -> plan -> default
    expect(seen).toEqual(['default', 'acceptEdits', 'plan', 'default'])
  })

  test('cycle is closed: every mode maps to a defined next mode', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk']) {
      expect(typeof getNextPermissionMode(ctx({ mode }))).toBe('string')
    }
  })
})
