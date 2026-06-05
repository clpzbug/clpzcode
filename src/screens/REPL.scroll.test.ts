import { describe, expect, test } from 'bun:test'
import {
  computeUnseenDivider,
  countUnseenAssistantTurns,
} from '../components/FullscreenLayout.js'

// --- Fixtures ---------------------------------------------------------------

const userText = (t: string) =>
  ({ type: 'user' as const, uuid: `ut-${t}`, message: { role: 'user', content: [{ type: 'text', text: t }] } })

const assistantText = (id: string, text = 'answer') =>
  ({ type: 'assistant' as const, uuid: `u-${id}`, message: { id, role: 'assistant', content: [{ type: 'text', text }] } })

const assistantToolUse = (id: string, toolId: string) =>
  ({ type: 'assistant' as const, uuid: `u-${id}`, message: { id, role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: {} }] } })

const userToolResult = (toolId: string) =>
  ({ type: 'user' as const, uuid: `ur-${toolId}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok' }] } })

const progress = () => ({ type: 'progress' as const, uuid: 'p', data: { type: 'bash_progress' } })

// --- countUnseenAssistantTurns ----------------------------------------------

describe('countUnseenAssistantTurns', () => {
  test('a tool_use-only assistant entry does not count as its own turn', () => {
    // [user, asst(tool_use), tool_result, asst(text)] from divider at the
    // tool_use: only ONE real turn (the text reply). tool_use is skipped.
    const msgs = [userText('hello'), assistantToolUse('t', 'tool-1'), userToolResult('tool-1'), assistantText('reply')]
    expect(countUnseenAssistantTurns(msgs as any, 1)).toBe(1)
  })

  test('text-block assistant + following tool_use are the same turn (1)', () => {
    const msgs = [assistantText('a', 'thinking'), assistantToolUse('b', 'tool-1')]
    expect(countUnseenAssistantTurns(msgs as any, 0)).toBe(1)
  })

  test('two separated assistant text turns count as 2', () => {
    const msgs = [assistantText('a'), userText('q'), assistantText('b')]
    expect(countUnseenAssistantTurns(msgs as any, 0)).toBe(2)
  })

  test('progress messages are ignored entirely', () => {
    const msgs = [progress(), assistantText('a')]
    expect(countUnseenAssistantTurns(msgs as any, 0)).toBe(1)
  })
})

// --- computeUnseenDivider ----------------------------------------------------

describe('computeUnseenDivider', () => {
  const msgs = [userText('hello'), assistantToolUse('t', 'tool-1'), userToolResult('tool-1'), assistantText('reply')]

  test('null dividerIndex => no divider', () => {
    expect(computeUnseenDivider(msgs as any, null)).toBeUndefined()
  })

  test('out-of-range dividerIndex => no divider', () => {
    expect(computeUnseenDivider(msgs as any, 99)).toBeUndefined()
  })

  test('anchors UUID at the divider index, even on a tool_use-only entry', () => {
    // dividerIndex=1 points at the tool_use assistant; its uuid is the anchor.
    const result = computeUnseenDivider(msgs as any, 1)
    expect(result?.firstUnseenUuid).toBe('u-t')
  })

  test('count floors at 1 once any content arrives past the divider', () => {
    // Pill flips to "1 new message" during a tool-call sequence, before text.
    const result = computeUnseenDivider(msgs as any, 1)
    expect(result?.count).toBe(1)
  })

  test('skips a leading progress message when picking the anchor', () => {
    // Divider points at progress; anchor advances to the next renderable msg.
    const withProgress = [userText('hello'), progress(), assistantText('reply')]
    const result = computeUnseenDivider(withProgress as any, 1)
    expect(result?.firstUnseenUuid).toBe('u-reply')
  })
})
