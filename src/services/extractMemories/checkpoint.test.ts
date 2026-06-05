import { expect, test } from 'bun:test'
import type { Message } from '../../types/message.ts'
import { countToolUsesSince } from './extractMemories.ts'

function asst(uuid: string, toolUses: number): Message {
  return {
    type: 'assistant',
    uuid,
    message: {
      content: Array.from({ length: toolUses }, () => ({ type: 'tool_use' })),
    },
  } as unknown as Message
}

function user(uuid: string): Message {
  return { type: 'user', uuid, message: { content: 'hi' } } as unknown as Message
}

test('counts all tool_use blocks when there is no cursor', () => {
  expect(countToolUsesSince([asst('a', 2), user('b'), asst('c', 3)], undefined)).toBe(5)
})

test('counts only tool_use blocks after the cursor', () => {
  expect(countToolUsesSince([asst('a', 2), asst('b', 1), asst('c', 3)], 'b')).toBe(3)
})

test('the cursor message itself is not counted', () => {
  expect(countToolUsesSince([asst('a', 2), asst('b', 4)], 'b')).toBe(0)
})

test('falls back to counting all when the cursor is absent (stale/compacted)', () => {
  expect(countToolUsesSince([asst('a', 2), asst('c', 3)], 'missing')).toBe(5)
})

test('ignores non-assistant messages', () => {
  expect(countToolUsesSince([user('u1'), asst('a', 2), user('u2')], undefined)).toBe(2)
})
