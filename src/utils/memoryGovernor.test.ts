import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  CRITICAL_RATIO,
  ELEVATED_RATIO,
  HIGH_RATIO,
  type MemoryPressure,
  type MemorySample,
  __test,
  classifyPressure,
  getLastMemorySample,
  isMemoryGovernorRunning,
  registerCacheClearer,
  registerEmergencyReclaimer,
  sampleMemory,
  startMemoryGovernor,
  stopMemoryGovernor,
  subscribeMemoryPressure,
} from './memoryGovernor.js'

function makeSample(pressure: MemoryPressure): MemorySample {
  return { heapUsed: 100, heapLimit: 1000, rss: 200, ratio: 0.5, rssRatio: 0.2, pressure }
}

beforeEach(() => __test.reset())
afterEach(() => __test.reset())

describe('classifyPressure thresholds', () => {
  test('normal below elevated', () => {
    expect(classifyPressure(0)).toBe('normal')
    expect(classifyPressure(ELEVATED_RATIO - 0.001)).toBe('normal')
  })
  test('elevated band', () => {
    expect(classifyPressure(ELEVATED_RATIO)).toBe('elevated')
    expect(classifyPressure(HIGH_RATIO - 0.001)).toBe('elevated')
  })
  test('high band', () => {
    expect(classifyPressure(HIGH_RATIO)).toBe('high')
    expect(classifyPressure(CRITICAL_RATIO - 0.001)).toBe('high')
  })
  test('critical at and above ceiling ratio', () => {
    expect(classifyPressure(CRITICAL_RATIO)).toBe('critical')
    expect(classifyPressure(1)).toBe('critical')
    expect(classifyPressure(1.5)).toBe('critical')
  })
  test('thresholds are ordered', () => {
    expect(ELEVATED_RATIO).toBeLessThan(HIGH_RATIO)
    expect(HIGH_RATIO).toBeLessThan(CRITICAL_RATIO)
  })
})

describe('sampleMemory', () => {
  test('returns a coherent sample from real process memory', () => {
    const s = sampleMemory()
    expect(s.heapUsed).toBeGreaterThan(0)
    expect(s.rss).toBeGreaterThan(0)
    expect(s.heapLimit).toBeGreaterThanOrEqual(0)
    expect(s.ratio).toBeGreaterThanOrEqual(0)
    expect(s.rssRatio).toBeGreaterThanOrEqual(s.ratio)
    // pressure tiers on the worse of heap pressure and RSS pressure (rss is
    // always >= heapUsed, so it catches off-heap growth the heap ratio misses).
    expect(s.pressure).toBe(classifyPressure(Math.max(s.ratio, s.rssRatio)))
  })
})

describe('applyPressureActions — tier dispatch', () => {
  test('normal: runs no reclaimers', () => {
    let cache = 0
    let emergency = 0
    registerCacheClearer(() => cache++)
    registerEmergencyReclaimer(() => emergency++)
    __test.applyPressureActions(makeSample('normal'), 1_000_000)
    expect(cache).toBe(0)
    expect(emergency).toBe(0)
  })

  test('elevated: no cache clear, no emergency (soft GC only)', () => {
    let cache = 0
    let emergency = 0
    registerCacheClearer(() => cache++)
    registerEmergencyReclaimer(() => emergency++)
    __test.applyPressureActions(makeSample('elevated'), 1_000_000)
    expect(cache).toBe(0)
    expect(emergency).toBe(0)
  })

  test('high: clears caches AND emergency reclaimers', () => {
    let cache = 0
    let emergency = 0
    registerCacheClearer(() => cache++)
    registerEmergencyReclaimer(() => emergency++)
    __test.applyPressureActions(makeSample('high'), 1_000_000)
    expect(cache).toBe(1)
    expect(emergency).toBe(1)
  })

  test('high: respects cooldown between cycles', () => {
    let cache = 0
    registerCacheClearer(() => cache++)
    const t0 = 1_000_000
    __test.applyPressureActions(makeSample('high'), t0)
    expect(cache).toBe(1)
    // within HIGH_COOLDOWN_MS → no second clear
    __test.applyPressureActions(makeSample('high'), t0 + __test.cooldowns.HIGH_COOLDOWN_MS - 1)
    expect(cache).toBe(1)
    // past cooldown → clears again
    __test.applyPressureActions(makeSample('high'), t0 + __test.cooldowns.HIGH_COOLDOWN_MS)
    expect(cache).toBe(2)
  })

  test('an elevated soft-GC does not suppress a high reclaim moments later (per-tier cooldowns)', () => {
    let cache = 0
    registerCacheClearer(() => cache++)
    const t0 = 1_000_000
    // elevated only stamps the elevated clock (no cache clear at this tier)
    __test.applyPressureActions(makeSample('elevated'), t0)
    expect(cache).toBe(0)
    // pressure rises to high 1ms later — a shared clock used to block this; with
    // per-tier clocks the high reclaim must still fire.
    __test.applyPressureActions(makeSample('high'), t0 + 1)
    expect(cache).toBe(1)
  })

  test('critical: clears caches AND emergency reclaimers, ignoring cooldown', () => {
    let cache = 0
    let emergency = 0
    registerCacheClearer(() => cache++)
    registerEmergencyReclaimer(() => emergency++)
    const now = 1_000_000
    // Pretend an action just happened — critical must still act this instant.
    __test.setLastActionAt(now)
    __test.applyPressureActions(makeSample('critical'), now)
    expect(cache).toBe(1)
    expect(emergency).toBe(1)
    // and again immediately — no cooldown gating for critical
    __test.applyPressureActions(makeSample('critical'), now)
    expect(cache).toBe(2)
    expect(emergency).toBe(2)
  })

  test('a throwing reclaimer does not abort the others', () => {
    let second = 0
    registerCacheClearer(() => {
      throw new Error('boom')
    })
    registerCacheClearer(() => second++)
    expect(() =>
      __test.applyPressureActions(makeSample('high'), 1_000_000),
    ).not.toThrow()
    expect(second).toBe(1)
  })
})

describe('registration lifecycle', () => {
  test('unsubscribe removes reclaimers and listeners', () => {
    const offCache = registerCacheClearer(() => {})
    const offEmergency = registerEmergencyReclaimer(() => {})
    const offListener = subscribeMemoryPressure(() => {})
    expect(__test.counts()).toEqual({
      cacheClearers: 1,
      emergencyReclaimers: 1,
      listeners: 1,
    })
    offCache()
    offEmergency()
    offListener()
    expect(__test.counts()).toEqual({
      cacheClearers: 0,
      emergencyReclaimers: 0,
      listeners: 0,
    })
  })

  test('subscribe fires immediately when a sample already exists', () => {
    __test.runGovernorCycle(1_000_000) // populates lastSample
    expect(getLastMemorySample()).not.toBeNull()
    let received: MemorySample | null = null
    subscribeMemoryPressure(s => {
      received = s
    })
    expect(received).not.toBeNull()
  })

  test('runGovernorCycle notifies all listeners once', () => {
    let calls = 0
    subscribeMemoryPressure(() => calls++)
    // subscribe fired 0 times (no prior sample after reset)
    __test.runGovernorCycle(1_000_000)
    expect(calls).toBe(1)
    __test.runGovernorCycle(1_000_000)
    expect(calls).toBe(2)
  })
})

describe('start/stop lifecycle', () => {
  test('start is idempotent and stop clears the timer', () => {
    expect(isMemoryGovernorRunning()).toBe(false)
    const stop1 = startMemoryGovernor()
    expect(isMemoryGovernorRunning()).toBe(true)
    // second start must not create a second interval
    startMemoryGovernor()
    expect(isMemoryGovernorRunning()).toBe(true)
    stop1()
    expect(isMemoryGovernorRunning()).toBe(false)
    stopMemoryGovernor() // safe to call when already stopped
    expect(isMemoryGovernorRunning()).toBe(false)
  })
})
