import { describe, expect, test } from 'bun:test'
import { apiRetryStatusChunk } from './agentBridge.js'

// Locks the reconnect-indicator mapping that turns QueryEngine's api_retry
// system message into a transient status chunk. Before this, the agent bridge
// dropped api_retry and a network-recovery wait (VPN drop mid-stream) read as a
// silent freeze.
describe('apiRetryStatusChunk — reconnect indicator mapping', () => {
  test('positive retry_delay_ms → timed reconnect with countdown fields', () => {
    const chunk = apiRetryStatusChunk({ attempt: 3, retry_delay_ms: 8000 })
    expect(chunk.type).toBe('status')
    expect(chunk.statusPhase).toBe('reconnecting')
    expect(chunk.statusAttempt).toBe(3)
    expect(chunk.statusRetryInMs).toBe(8000)
  })

  test('retry_delay_ms of 0 → wait-for-connectivity (network_wait, no countdown)', () => {
    const chunk = apiRetryStatusChunk({ attempt: 1, retry_delay_ms: 0 })
    expect(chunk.statusPhase).toBe('network_wait')
    expect(chunk.statusRetryInMs).toBe(0)
    expect(chunk.statusAttempt).toBe(1)
  })

  test('missing fields default to network_wait, attempt 1, 0ms', () => {
    const chunk = apiRetryStatusChunk({})
    expect(chunk.statusPhase).toBe('network_wait')
    expect(chunk.statusAttempt).toBe(1)
    expect(chunk.statusRetryInMs).toBe(0)
  })
})
