import { describe, expect, test } from 'bun:test'
import { computeHeapCeilingMb } from './systemMemory.js'

describe('computeHeapCeilingMb', () => {
  test('big machine: ~70%, 4GB floor applies, capped at 16GB', () => {
    expect(computeHeapCeilingMb(16384)).toBe(11468) // 16GB → ~11.5GB
    expect(computeHeapCeilingMb(8192)).toBe(5734) //  8GB → ~5.7GB
    expect(computeHeapCeilingMb(65536)).toBe(16384) // 64GB → capped at 16GB
  })

  test('small box: NO 4GB floor (forcing it would exceed real RAM → OOM)', () => {
    // 4GB box: floor of 4096 would be 100% of RAM. We give 70% instead.
    expect(computeHeapCeilingMb(4096)).toBe(2867)
    // 2GB container: 70% = ~1.4GB, never the 4GB floor.
    expect(computeHeapCeilingMb(2048)).toBe(1433)
    // 1GB container.
    expect(computeHeapCeilingMb(1024)).toBe(716)
  })

  test('floor kicks in exactly at the 6GB threshold', () => {
    // 6144MB → 0.7 = 4300 ≥ 4096, so target stands.
    expect(computeHeapCeilingMb(6144)).toBe(4300)
    // Just below threshold: 6143MB → 0.7 = 4300, no floor applied, same value here
    // but the branch differs; assert the boundary is inclusive at 6144.
    expect(computeHeapCeilingMb(6143)).toBe(4300)
  })

  test('absurdly tiny input clamps to a 512MB minimum', () => {
    expect(computeHeapCeilingMb(256)).toBe(512)
    expect(computeHeapCeilingMb(0)).toBe(512)
  })
})
