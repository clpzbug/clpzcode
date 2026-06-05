import { describe, expect, test } from 'bun:test'
import { evictOldMessageContent, evictCompletedAgentProgress } from './REPL.eviction.js'

// --- Helpers -----------------------------------------------------------------

const makeAssistant = (id: string, thinking = '') => ({
  type: 'assistant' as const,
  message: {
    id,
    content: thinking
      ? [{ type: 'thinking', thinking }]
      : [{ type: 'text', text: 'hi' }],
  },
})

const makeUser = (toolUseId?: string, content = 'result') => ({
  type: 'user' as const,
  message: {
    content: toolUseId
      ? [{ type: 'tool_result', tool_use_id: toolUseId, content }]
      : [{ type: 'text', text: 'hello' }],
  },
  toolUseResult: toolUseId ? { data: 'big object' } : undefined,
})

const makeProgress = (
  parentToolUseID: string,
  dataType = 'agent_progress',
  evicted = false,
) => ({
  type: 'progress' as const,
  parentToolUseID,
  toolUseID: `${parentToolUseID}-sub-${Math.random()}`,
  uuid: `uuid-${Math.random()}`,
  timestamp: new Date().toISOString(),
  data: evicted
    ? { type: dataType, evicted: true }
    : { type: dataType, message: { big: 'payload'.repeat(1000) } },
})

const makeBashProgress = (parentToolUseID: string) =>
  makeProgress(parentToolUseID, 'bash_progress')

// --- evictOldMessageContent --------------------------------------------------

describe('evictOldMessageContent', () => {
  test('no-op when fewer than 2 assistant turns', () => {
    const msgs = [makeAssistant('a1'), makeUser()]
    expect(evictOldMessageContent(msgs)).toBe(msgs) // same reference = no change
  })

  test('evicts thinking blocks before boundary', () => {
    const old = makeAssistant('a0', 'big thinking text here')
    const msgs = [old, makeUser(), makeAssistant('a1'), makeUser(), makeAssistant('a2')]
    const result = evictOldMessageContent(msgs)
    const evictedThinking = (result[0] as any).message.content[0].thinking
    expect(evictedThinking).toBe('')
    // Recent messages untouched
    expect((result[2] as any).message.content).toBe(
      (msgs[2] as any).message.content,
    )
  })

  test('evicts ALL progress types before boundary (including agent_progress)', () => {
    const agentProg = makeProgress('agent-1', 'agent_progress')
    const bashProg = makeBashProgress('bash-1')
    const msgs = [
      agentProg,
      bashProg,
      makeAssistant('a1'),
      makeUser(),
      makeAssistant('a2'),
    ]
    const result = evictOldMessageContent(msgs)
    expect((result[0] as any).data.evicted).toBe(true)
    expect((result[1] as any).data.evicted).toBe(true)
  })

  test('does not re-evict already-evicted progress', () => {
    const alreadyEvicted = makeProgress('agent-1', 'agent_progress', true)
    const msgs = [alreadyEvicted, makeAssistant('a1'), makeUser(), makeAssistant('a2')]
    const result = evictOldMessageContent(msgs)
    // Should not change — same reference returned for that item
    expect(result[0]).toBe(msgs[0])
  })

  test('evicts tool_result content from old user messages', () => {
    const oldUser = makeUser('tool-id-1', 'large result content')
    const msgs = [oldUser, makeAssistant('a1'), makeUser(), makeAssistant('a2')]
    const result = evictOldMessageContent(msgs)
    const block = (result[0] as any).message.content[0]
    expect(block.content).not.toBe('large result content')
    expect((result[0] as any).toolUseResult).toBeUndefined()
  })
})

// --- evictCompletedAgentProgress ---------------------------------------------

describe('evictCompletedAgentProgress', () => {
  test('no-op when no completed agents', () => {
    // Progress message with parentToolUseID that has no tool_result
    const prog = makeProgress('pending-agent')
    const msgs = [prog, makeAssistant('a1')]
    expect(evictCompletedAgentProgress(msgs)).toBe(msgs)
  })

  test('evicts progress for a completed agent mid-turn', () => {
    const parentId = 'agent-use-123'
    const prog1 = makeProgress(parentId)
    const prog2 = makeProgress(parentId)
    const result = makeUser(parentId) // tool_result marks agent as done
    const msgs = [prog1, prog2, result, makeAssistant('a1')]
    const evicted = evictCompletedAgentProgress(msgs)
    expect((evicted[0] as any).data.evicted).toBe(true)
    expect((evicted[1] as any).data.evicted).toBe(true)
    // User message and assistant untouched
    expect(evicted[2]).toBe(msgs[2])
    expect(evicted[3]).toBe(msgs[3])
  })

  test('does not evict progress for a still-running agent', () => {
    const completedId = 'done-agent'
    const runningId = 'running-agent'
    const doneProg = makeProgress(completedId)
    const runningProg = makeProgress(runningId)
    const doneResult = makeUser(completedId)
    const msgs = [doneProg, runningProg, doneResult]
    const evicted = evictCompletedAgentProgress(msgs)
    expect((evicted[0] as any).data.evicted).toBe(true)   // done — evicted
    expect((evicted[1] as any).data.evicted).toBeUndefined() // running — kept
  })

  test('does not re-evict already-evicted progress', () => {
    const parentId = 'agent-use-999'
    const already = makeProgress(parentId, 'agent_progress', true)
    const result = makeUser(parentId)
    const msgs = [already, result]
    const evicted = evictCompletedAgentProgress(msgs)
    expect(evicted).toBe(msgs) // same reference, no change
  })

  test('no-op when messages array is empty', () => {
    expect(evictCompletedAgentProgress([])).toStrictEqual([])
  })
})

// --- evictOldMessageContent — file-mutation tool_use -------------------------

const makeWriteUse = (id: string, filePath: string, content: string) => ({
  type: 'assistant' as const,
  message: { id, content: [{ type: 'tool_use', id, name: 'Write', input: { file_path: filePath, content } }] },
})
const makeEditUse = (id: string, filePath: string, oldS: string, newS: string) => ({
  type: 'assistant' as const,
  message: { id, content: [{ type: 'tool_use', id, name: 'Edit', input: { file_path: filePath, old_string: oldS, new_string: newS } }] },
})

describe('evictOldMessageContent — file-mutation tool_use', () => {
  test('strips completed Write input but preserves file_path', () => {
    const w = makeWriteUse('w1', '/x.ts', 'HUGE'.repeat(10000))
    const msgs = [w, makeUser('w1'), makeAssistant('a1'), makeUser(), makeAssistant('a2')]
    const out = evictOldMessageContent(msgs)
    const blk = (out[0] as any).message.content[0]
    expect(blk.input.content).toBe('')
    expect(blk.input.file_path).toBe('/x.ts') // renderer needs this
  })

  test('strips completed Edit old/new_string, keeps file_path', () => {
    const e = makeEditUse('e1', '/y.ts', 'OLD'.repeat(5000), 'NEW'.repeat(5000))
    const msgs = [e, makeUser('e1'), makeAssistant('a1'), makeUser(), makeAssistant('a2')]
    const out = evictOldMessageContent(msgs)
    const blk = (out[0] as any).message.content[0]
    expect(blk.input.old_string).toBe('')
    expect(blk.input.new_string).toBe('')
    expect(blk.input.file_path).toBe('/y.ts')
  })

  test('does NOT strip a Write without a tool_result (in-flight)', () => {
    const w = makeWriteUse('w2', '/z.ts', 'PAYLOAD')
    // no makeUser('w2') → no tool_result for w2
    const msgs = [w, makeUser(), makeAssistant('a1'), makeUser(), makeAssistant('a2')]
    const out = evictOldMessageContent(msgs)
    expect((out[0] as any).message.content[0].input.content).toBe('PAYLOAD')
  })

  test('does NOT strip within the 2 most recent turns', () => {
    // Write is after the boundary (recent) → untouched even with a result.
    const w = makeWriteUse('w3', '/r.ts', 'RECENT')
    const msgs = [makeAssistant('a0'), makeUser(), makeAssistant('a1'), w, makeUser('w3'), makeAssistant('a2')]
    const out = evictOldMessageContent(msgs)
    const widx = out.findIndex((m: any) => m.message?.id === 'w3')
    expect((out[widx] as any).message.content[0].input.content).toBe('RECENT')
  })

  test('idempotent: re-running keeps reference once stripped', () => {
    const w = makeWriteUse('w4', '/i.ts', 'BIG')
    const msgs = [w, makeUser('w4'), makeAssistant('a1'), makeUser(), makeAssistant('a2')]
    const once = evictOldMessageContent(msgs)
    const twice = evictOldMessageContent(once)
    expect(twice).toBe(once) // no change second time
  })
})
