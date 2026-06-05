// src/utils/version.test.ts
//
// Regression guard: version helpers must not crash when the MACRO build-time
// define is absent (raw bun / unit tests). getPublicBuildVersion used to throw
// "MACRO is not defined" outside a build.
import { describe, expect, test } from 'bun:test'
import { getPublicBuildVersion, normalizePublicVersion, publicBuildVersion } from './version.js'

describe('version helpers (build-time MACRO safe)', () => {
  test('publicBuildVersion is a non-empty string (reads package.json from disk)', () => {
    expect(typeof publicBuildVersion).toBe('string')
    expect(publicBuildVersion.length).toBeGreaterThan(0)
  })

  test('getPublicBuildVersion never throws without the MACRO define', () => {
    expect(() => getPublicBuildVersion()).not.toThrow()
    expect(typeof getPublicBuildVersion()).toBe('string')
  })

  test('normalizePublicVersion coerces / strips a leading v', () => {
    expect(normalizePublicVersion('v1.2.3')).toBe('1.2.3')
    expect(normalizePublicVersion('  2.0.0 ')).toBe('2.0.0')
  })
})
