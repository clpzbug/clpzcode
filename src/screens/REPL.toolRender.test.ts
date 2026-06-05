import { describe, expect, test } from 'bun:test'
import {
  getToolUseID,
  getToolUseIDs,
  buildMessageLookups,
  normalizeMessages,
  isNotEmptyMessage,
} from '../utils/messages.js'

// --- Fixtures ---------------------------------------------------------------

const assistantToolUse = (id: string, toolId: string) =>
  ({ type: 'assistant' as const, uuid: `u-${id}`, message: { id, role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: {} }] } })

const assistantText = (id: string, text = 'hi') =>
  ({ type: 'assistant' as const, uuid: `u-${id}`, message: { id, role: 'assistant', content: [{ type: 'text', text }] } })

const userToolResult = (toolId: string) =>
  ({ type: 'user' as const, uuid: `ur-${toolId}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok' }] } })

// --- getToolUseID: per-message tool-id extraction ---------------------------
// shouldRenderStatically keys off this to decide static-vs-transient rendering.

describe('getToolUseID', () => {
  test('assistant tool_use returns its block id', () => {
    expect(getToolUseID(assistantToolUse('a', 'tool-1') as any)).toBe('tool-1')
  })

  test('assistant text-only returns null (no tool use)', () => {
    expect(getToolUseID(assistantText('a') as any)).toBeNull()
  })

  test('user tool_result returns the matching tool_use_id', () => {
    expect(getToolUseID(userToolResult('tool-1') as any)).toBe('tool-1')
  })

  test('progress message returns its toolUseID', () => {
    expect(getToolUseID({ type: 'progress', toolUseID: 'p-1' } as any)).toBe('p-1')
  })

  test('informational system message returns its toolUseID', () => {
    expect(
      getToolUseID({ type: 'system', subtype: 'informational', toolUseID: 's-1' } as any),
    ).toBe('s-1')
  })

  test('non-informational system message returns null', () => {
    expect(getToolUseID({ type: 'system', subtype: 'api_error' } as any)).toBeNull()
  })
})

// --- getToolUseIDs: set of all pending tool uses in (normalized) history ----

describe('getToolUseIDs', () => {
  test('collects ids from tool_use assistant messages only', () => {
    const norm = normalizeMessages([
      assistantToolUse('a', 'tool-1'),
      assistantText('b'),
    ] as any)
    expect([...getToolUseIDs(norm)]).toEqual(['tool-1'])
  })
})

// --- buildMessageLookups.resolvedToolUseIDs: "this tool is done" ------------
// This is the exact signal shouldRenderStatically uses: a tool_use is static
// only once its id is in resolvedToolUseIDs (a matching tool_result exists).

describe('buildMessageLookups — resolvedToolUseIDs', () => {
  test('a tool_use with a matching tool_result is resolved', () => {
    const raw = [assistantToolUse('a', 'tool-1'), userToolResult('tool-1')]
    const lookups = buildMessageLookups(normalizeMessages(raw as any), raw as any)
    expect(lookups.resolvedToolUseIDs.has('tool-1')).toBe(true)
  })

  test('a tool_use without any tool_result is NOT resolved (still in-flight)', () => {
    const raw = [assistantToolUse('a', 'tool-2')]
    const lookups = buildMessageLookups(normalizeMessages(raw as any), raw as any)
    expect(lookups.resolvedToolUseIDs.has('tool-2')).toBe(false)
  })

  test('lookups expose the documented resolution maps', () => {
    const raw = [assistantToolUse('a', 'tool-1'), userToolResult('tool-1')]
    const lookups = buildMessageLookups(normalizeMessages(raw as any), raw as any)
    expect(lookups).toHaveProperty('resolvedToolUseIDs')
    expect(lookups).toHaveProperty('toolResultByToolUseID')
    expect(lookups).toHaveProperty('siblingToolUseIDs')
  })
})

// --- isNotEmptyMessage: the render-list pre-filter ---------------------------

describe('isNotEmptyMessage (render pre-filter)', () => {
  test('assistant with text is not empty', () => {
    expect(isNotEmptyMessage(assistantText('a', 'hi') as any)).toBe(true)
  })

  test('assistant with empty content array is empty', () => {
    expect(
      isNotEmptyMessage({ type: 'assistant', uuid: 'x', message: { id: 'x', role: 'assistant', content: [] } } as any),
    ).toBe(false)
  })
})
