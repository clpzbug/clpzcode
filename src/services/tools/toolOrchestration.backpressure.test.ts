import { describe, expect, test } from 'bun:test'
import { clampConcurrencyForPressure } from './toolOrchestration.js'

describe('clampConcurrencyForPressure (spawn backpressure under memory pressure)', () => {
  test('normal/elevated/undefined keep the full cap', () => {
    expect(clampConcurrencyForPressure(10, 'normal')).toBe(10)
    expect(clampConcurrencyForPressure(10, 'elevated')).toBe(10)
    expect(clampConcurrencyForPressure(10, undefined)).toBe(10)
  })

  test('high pressure halves the cap (floor, min 1)', () => {
    expect(clampConcurrencyForPressure(10, 'high')).toBe(5)
    expect(clampConcurrencyForPressure(3, 'high')).toBe(1)
    expect(clampConcurrencyForPressure(1, 'high')).toBe(1)
  })

  test('critical pressure serializes to 1', () => {
    expect(clampConcurrencyForPressure(10, 'critical')).toBe(1)
    expect(clampConcurrencyForPressure(1, 'critical')).toBe(1)
  })
})
