import { describe, expect, test } from 'bun:test'
import {
  shouldShowUserMessage,
  isCompactBoundaryMessage,
  getMessagesAfterCompactBoundary,
} from '../utils/messages.js'
import { isNullRenderingAttachment } from '../components/messages/nullRenderingAttachments.js'

// --- Fixtures ---------------------------------------------------------------

const userText = (t: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'user' as const, uuid: `ut-${t}`, message: { role: 'user', content: [{ type: 'text', text: t }] }, ...extra })

const assistantText = (id: string, text = 'hi') =>
  ({ type: 'assistant' as const, uuid: `u-${id}`, message: { id, role: 'assistant', content: [{ type: 'text', text }] } })

const compactBoundary = () =>
  ({ type: 'system' as const, subtype: 'compact_boundary', uuid: 'cb', content: '' })

const attachment = (attachmentType: string) =>
  ({ type: 'attachment' as const, uuid: `att-${attachmentType}`, attachment: { type: attachmentType } })

// --- shouldShowUserMessage: transcript visibility gating --------------------

describe('shouldShowUserMessage', () => {
  test('plain user message is always shown', () => {
    expect(shouldShowUserMessage(userText('hi') as any, false)).toBe(true)
  })

  test('meta user message is hidden (default external build)', () => {
    expect(shouldShowUserMessage(userText('hi', { isMeta: true }) as any, false)).toBe(false)
  })

  test('transcript-only message is hidden in normal mode', () => {
    expect(
      shouldShowUserMessage(userText('hi', { isVisibleInTranscriptOnly: true }) as any, false),
    ).toBe(false)
  })

  test('transcript-only message is shown in transcript mode (ctrl+o)', () => {
    expect(
      shouldShowUserMessage(userText('hi', { isVisibleInTranscriptOnly: true }) as any, true),
    ).toBe(true)
  })
})

// --- isNullRenderingAttachment: invisible attachments stay out of the count -

describe('isNullRenderingAttachment', () => {
  test('hook_success attachment renders null', () => {
    expect(isNullRenderingAttachment(attachment('hook_success') as any)).toBe(true)
  })

  test('hook_additional_context attachment renders null', () => {
    expect(isNullRenderingAttachment(attachment('hook_additional_context') as any)).toBe(true)
  })

  test('a visible attachment type does not render null', () => {
    expect(isNullRenderingAttachment(attachment('queued_command') as any)).toBe(false)
  })

  test('a non-attachment message is never null-rendering', () => {
    expect(isNullRenderingAttachment(userText('hi') as any)).toBe(false)
  })
})

// --- compact boundary slicing -----------------------------------------------

describe('compact boundary', () => {
  test('isCompactBoundaryMessage identifies the system marker', () => {
    expect(isCompactBoundaryMessage(compactBoundary() as any)).toBe(true)
    expect(isCompactBoundaryMessage(assistantText('a') as any)).toBe(false)
  })

  test('getMessagesAfterCompactBoundary keeps the boundary and everything after', () => {
    const msgs = [userText('old'), compactBoundary(), assistantText('new')]
    const sliced = getMessagesAfterCompactBoundary(msgs as any)
    expect(sliced.map((m: any) => m.type)).toEqual(['system', 'assistant'])
  })

  test('with no boundary, all messages are returned unchanged', () => {
    const msgs = [userText('a'), assistantText('b')]
    expect(getMessagesAfterCompactBoundary(msgs as any).length).toBe(2)
  })

  test('slices from the LAST boundary when multiple exist', () => {
    const msgs = [userText('a'), compactBoundary(), userText('b'), compactBoundary(), assistantText('c')]
    const sliced = getMessagesAfterCompactBoundary(msgs as any)
    // Only the final boundary + the assistant after it survive.
    expect(sliced.map((m: any) => m.type)).toEqual(['system', 'assistant'])
    expect(sliced.length).toBe(2)
  })
})
