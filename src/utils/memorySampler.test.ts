import { describe, expect, test } from 'bun:test'
import { __test, formatSample, startMemorySampler } from './memorySampler.js'
import { __test as gov } from './memoryGovernor.js'

const usage = (rss: number, heapUsed: number, extra: Partial<NodeJS.MemoryUsage> = {}) =>
  ({ rss, heapUsed, heapTotal: heapUsed, external: 0, arrayBuffers: 0, ...extra }) as NodeJS.MemoryUsage

describe('formatSample', () => {
  test('classifies native-dominated growth', () => {
    const base = __test.snapshot(() => usage(1_000e6, 500e6), () => 0)
    // heap flat, rss up 4 GB → native-dominated
    const s = __test.snapshot(() => usage(5_000e6, 500e6), () => 1)
    expect(formatSample(s, base)).toContain('NATIVE-dominated')
  })
  test('classifies heap-dominated growth', () => {
    const base = __test.snapshot(() => usage(1_000e6, 500e6), () => 0)
    const s = __test.snapshot(() => usage(5_000e6, 4_500e6), () => 1)
    expect(formatSample(s, base)).toContain('HEAP-dominated')
  })
})

describe('startMemorySampler auto-dump', () => {
  test('fires one dump when rss crosses threshold, respects cap', async () => {
    gov.reset()
    let dumps = 0
    let t = 0
    let rss = 1_000e6
    const stop = startMemorySampler({
      sampleEveryNTicks: 1,
      rssDumpThresholdBytes: 9_000e6,
      maxAutoDumps: 1,
      dumpCooldownMs: 0,
      now: () => t,
      readUsage: () => usage(rss, 500e6),
      dump: async () => { dumps++ },
    })
    // tick 1: baseline (below threshold)
    gov.runGovernorCycle()
    // climb above threshold
    rss = 9_500e6
    t = 1; gov.runGovernorCycle()
    await Promise.resolve()
    expect(dumps).toBe(1)
    // still above, but cap=1 → no second dump
    t = 2; gov.runGovernorCycle()
    await Promise.resolve()
    expect(dumps).toBe(1)
    stop()
    gov.reset()
  })

  test('no dump below threshold', async () => {
    gov.reset()
    let dumps = 0
    const stop = startMemorySampler({
      sampleEveryNTicks: 1,
      rssDumpThresholdBytes: 9_000e6,
      now: () => 0,
      readUsage: () => usage(2_000e6, 500e6),
      dump: async () => { dumps++ },
    })
    gov.runGovernorCycle()
    gov.runGovernorCycle()
    await Promise.resolve()
    expect(dumps).toBe(0)
    stop()
    gov.reset()
  })
})
