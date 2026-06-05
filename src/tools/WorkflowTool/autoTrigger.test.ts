// src/tools/WorkflowTool/autoTrigger.test.ts
import { describe, expect, test } from 'bun:test'
import { scoreWorkflowPrompt, SUGGEST_THRESHOLD } from './autoTrigger.js'

describe('scoreWorkflowPrompt', () => {
  test('a simple single-task prompt does NOT suggest a workflow', () => {
    const r = scoreWorkflowPrompt('fix the typo in the header')
    expect(r.suggest).toBe(false)
    expect(r.score).toBeLessThan(SUGGEST_THRESHOLD)
  })

  test('"add tests for all X" fan-out phrase suggests', () => {
    const r = scoreWorkflowPrompt('add tests for all the components in the ui folder')
    expect(r.suggest).toBe(true)
  })

  test('an enumerated multi-item list suggests', () => {
    const r = scoreWorkflowPrompt(
      'do these:\n1. refactor the auth module\n2. add tests\n3. update the docs\n4. fix the lint errors',
    )
    expect(r.suggest).toBe(true)
    expect(r.reasons.join(' ')).toContain('enumerated')
  })

  test('multiple distinct file targets + verbs suggests', () => {
    const r = scoreWorkflowPrompt(
      'refactor src/a.ts, migrate src/b.ts and rewrite src/c.tsx to the new API',
    )
    expect(r.suggest).toBe(true)
  })

  test('"migrate ... across all" scores high', () => {
    const r = scoreWorkflowPrompt('migrate every endpoint across all the services')
    expect(r.score).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD)
  })

  test('a question does not suggest', () => {
    expect(scoreWorkflowPrompt('what does this function do?').suggest).toBe(false)
  })
})
