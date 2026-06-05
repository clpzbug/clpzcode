import { describe, expect, test } from 'bun:test'
import { isHumanTurn } from '../utils/messagePredicates.js'
import { textForResubmit } from '../utils/messages.js'
import {
  selectableUserMessagesFilter,
  messagesAfterAreOnlySynthetic,
} from '../utils/messageFilters.js'

// --- Fixtures (object-literal + `as any`, same style as REPL.eviction.test.ts) ---

const userText = (text: string, extra: Record<string, unknown> = {}) =>
  ({
    type: 'user' as const,
    uuid: `ut-${text}`,
    message: { role: 'user', content: [{ type: 'text', text }] },
    ...extra,
  })

const userToolResult = (toolUseId: string) =>
  ({
    type: 'user' as const,
    uuid: `ur-${toolUseId}`,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }],
    },
    toolUseResult: { ok: true },
  })

const assistant = (text = 'hi') =>
  ({
    type: 'assistant' as const,
    uuid: 'a',
    message: { id: 'a', role: 'assistant', content: [{ type: 'text', text }] },
  })

// --- isHumanTurn: which messages are "the user's keyboard turns" -----------
// REPL uses this for the post-submit repin (lastMsgIsHuman) and turn counting.

describe('isHumanTurn (submit boundary)', () => {
  test('plain user text is a human turn', () => {
    expect(isHumanTurn(userText('hello') as any)).toBe(true)
  })

  test('tool_result user message is NOT a human turn', () => {
    // The discriminant is toolUseResult !== undefined, not type === 'user'.
    expect(isHumanTurn(userToolResult('tool-1') as any)).toBe(false)
  })

  test('meta user message is NOT a human turn', () => {
    expect(isHumanTurn(userText('hi', { isMeta: true }) as any)).toBe(false)
  })

  test('assistant message is NOT a human turn', () => {
    expect(isHumanTurn(assistant() as any)).toBe(false)
  })
})

// --- textForResubmit: round-tripping a past message back into the prompt ----
// Drives the "edit & resubmit" path (up-arrow / message selector resend).

describe('textForResubmit (resubmit routing)', () => {
  test('bash-input message resubmits in bash mode, tags stripped', () => {
    const msg = {
      type: 'user',
      uuid: 'x',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '<bash-input>ls -la</bash-input>' }],
      },
    }
    expect(textForResubmit(msg as any)).toEqual({ text: 'ls -la', mode: 'bash' })
  })

  test('command message resubmits as "name args" in prompt mode', () => {
    const msg = {
      type: 'user',
      uuid: 'x',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<command-name>review</command-name><command-args>foo</command-args>',
          },
        ],
      },
    }
    expect(textForResubmit(msg as any)).toEqual({ text: 'review foo', mode: 'prompt' })
  })

  test('plain user text resubmits verbatim in prompt mode', () => {
    expect(textForResubmit(userText('plain text') as any)).toEqual({
      text: 'plain text',
      mode: 'prompt',
    })
  })

  test('tool_result message is not resubmittable (returns null)', () => {
    expect(textForResubmit(userToolResult('tool-1') as any)).toBeNull()
  })
})

// --- selectableUserMessagesFilter: what the message selector offers ---------

describe('selectableUserMessagesFilter (selector eligibility)', () => {
  test('plain user text is selectable', () => {
    expect(selectableUserMessagesFilter(userText('hi') as any)).toBe(true)
  })

  test('tool_result is not selectable', () => {
    expect(selectableUserMessagesFilter(userToolResult('t1') as any)).toBe(false)
  })

  test('meta message is not selectable', () => {
    expect(selectableUserMessagesFilter(userText('hi', { isMeta: true }) as any)).toBe(false)
  })

  test('bash command output is not selectable', () => {
    expect(
      selectableUserMessagesFilter(userText('<bash-stdout>x</bash-stdout>') as any),
    ).toBe(false)
  })

  test('local command output is not selectable', () => {
    expect(
      selectableUserMessagesFilter(
        userText('<local-command-stdout>x</local-command-stdout>') as any,
      ),
    ).toBe(false)
  })
})

// --- messagesAfterAreOnlySynthetic: "did anything meaningful happen since?" --
// REPL uses this to decide whether a submit actually produced a turn worth
// keeping (e.g. user hit enter then immediately cancelled).

describe('messagesAfterAreOnlySynthetic (post-submit meaningfulness)', () => {
  test('only tool_results + progress after = nothing meaningful', () => {
    const msgs = [userText('q'), userToolResult('t1'), { type: 'progress' }]
    expect(messagesAfterAreOnlySynthetic(msgs as any, 0)).toBe(true)
  })

  test('an assistant message with real text IS meaningful', () => {
    expect(
      messagesAfterAreOnlySynthetic([userText('q'), assistant('real answer')] as any, 0),
    ).toBe(false)
  })

  test('an assistant message with only whitespace text is NOT meaningful', () => {
    expect(
      messagesAfterAreOnlySynthetic([userText('q'), assistant('   ')] as any, 0),
    ).toBe(true)
  })

  test('a subsequent non-meta user message IS meaningful', () => {
    expect(
      messagesAfterAreOnlySynthetic([userText('q'), userText('another')] as any, 0),
    ).toBe(false)
  })
})
