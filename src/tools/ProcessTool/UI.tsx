import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import type { ProcessOutput } from './ProcessTool.js'


export function renderToolUseMessage(
  input: Partial<{ action: string; name: string; cmd: string }>,
): React.ReactNode {
  if (!input?.action) return null
  const parts = [input.action, input.name, input.cmd ? `(${input.cmd})` : null].filter(Boolean)
  return parts.join(' ')
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Managing process…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(result: ProcessOutput): React.ReactNode {
  if (result.action === 'status') {
    if (result.processes.length === 0) {
      return (
        <MessageResponse height={1}>
          <Text dimColor>No managed processes running</Text>
        </MessageResponse>
      )
    }
    return (
      <MessageResponse height={result.processes.length}>
        <Box flexDirection="column">
          {result.processes.map(p => (
            <Box key={p.name} flexDirection="row" gap={1}>
              <Text color="success">●</Text>
              <Text bold>{p.name}</Text>
              {p.port && <Text dimColor>:{p.port}</Text>}
              <Text dimColor>pid={p.pid}</Text>
            </Box>
          ))}
        </Box>
      </MessageResponse>
    )
  }

  if (result.action === 'logs') {
    return (
      <MessageResponse height={1}>
        <Text>
          Logs: <Text bold>{result.name}</Text>
          <Text dimColor> ({result.log_lines} lines)</Text>
        </Text>
      </MessageResponse>
    )
  }

  const color =
    result.action === 'start' || result.action === 'restart' ? 'success' : 'error'
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={color}>{result.action === 'stop' ? 'Stopped' : 'Started'}</Text>
        <Text bold>{result.name}</Text>
        {result.pid && <Text dimColor>pid={result.pid}</Text>}
        {result.port && <Text dimColor>:{result.port}</Text>}
      </Box>
    </MessageResponse>
  )
}

export function getToolUseSummary(
  input: Partial<{ action: string; name: string }> | undefined,
): string | null {
  if (!input?.action) return null
  return input.name ? `${input.action} ${input.name}` : input.action
}
