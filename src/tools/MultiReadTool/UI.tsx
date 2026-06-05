import * as React from 'react'
import * as path from 'path'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import type { MultiReadOutput } from './MultiReadTool.js'

export function renderToolUseMessage(
  input: Partial<{ paths: string[] }>,
): React.ReactNode {
  if (!input?.paths?.length) return null
  const first = path.basename(String(input.paths[0]))
  return input.paths.length === 1 ? first : `${first} +${input.paths.length - 1} more`
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Reading files…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(result: MultiReadOutput): React.ReactNode {
  const items = result?.results ?? []
  const ok = items.filter(r => !('error' in r)).length
  const err = items.length - ok
  const height = Math.min(items.length + 1, 8)
  return (
    <MessageResponse height={height}>
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color="success">✓</Text>
          <Text bold>{ok} file{ok !== 1 ? 's' : ''}</Text>
          {err > 0 && <Text color="error">{err} error{err !== 1 ? 's' : ''}</Text>}
        </Box>
        {items.map(r => (
          <Box key={r.path} flexDirection="row" gap={1}>
            {'error' in r ? (
              <>
                <Text color="error">✗</Text>
                <Text dimColor>{path.basename(r.path)}</Text>
                <Text color="error" dimColor>{r.error}</Text>
              </>
            ) : (
              <>
                <Text dimColor>  {path.basename(r.path)}</Text>
                <Text dimColor>{r.lines}L</Text>
              </>
            )}
          </Box>
        ))}
      </Box>
    </MessageResponse>
  )
}

export function getToolUseSummary(
  input: Partial<{ paths: string[] }> | undefined,
): string | null {
  if (!input?.paths?.length) return null
  const first = path.basename(String(input.paths[0]))
  return input.paths.length === 1 ? first : `${first} +${input.paths.length - 1} more`
}
