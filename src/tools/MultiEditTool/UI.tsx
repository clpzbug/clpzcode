import * as React from 'react'
import * as path from 'path'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { SCAN_FRAMES } from '../../constants/animGlyphs.js'
import type { MultiEditOutput } from './MultiEditTool.js'

export function renderToolUseMessage(
  input: Partial<{ edits: Array<{ file_path: string }> }>,
): React.ReactNode {
  if (!input?.edits?.length) return null
  const files = [...new Set(input.edits.map(e => e.file_path))]
  return `${files.length} file${files.length !== 1 ? 's' : ''}`
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Editing files…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(result: MultiEditOutput): React.ReactNode {
  const items = result?.results ?? []
  const ok = items.filter(r => r.success).length
  const err = items.length - ok
  const height = Math.min(items.length + 1, 8)
  return (
    <MessageResponse height={height}>
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color="success">✓</Text>
          <Text bold>{ok} file{ok !== 1 ? 's' : ''} edited</Text>
          {err > 0 && <Text color="error">{err} failed</Text>}
        </Box>
        {items.map(r => (
          <Box key={r.file_path} flexDirection="row" gap={1}>
            {r.success ? (
              <>
                <Text dimColor>  {path.basename(r.file_path)}</Text>
              </>
            ) : (
              <>
                <Text color="error">✗</Text>
                <Text dimColor>{path.basename(r.file_path)}</Text>
              </>
            )}
          </Box>
        ))}
      </Box>
    </MessageResponse>
  )
}

export function getToolUseSummary(
  input: Partial<{ edits: Array<{ file_path: string }> }> | undefined,
): string | null {
  if (!input?.edits?.length) return null
  const files = [...new Set(input.edits.map(e => e.file_path))]
  return `${files.length} file${files.length !== 1 ? 's' : ''}`
}
