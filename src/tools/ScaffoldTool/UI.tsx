import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { SCAN_FRAMES } from '../../constants/animGlyphs.js'
import type { ScaffoldOutput } from './ScaffoldTool.js'

export function renderToolUseMessage(
  input: Partial<{ template: string; name: string }>,
): React.ReactNode {
  if (!input?.template) return null
  return input.name ? `${input.template} → ${input.name}` : input.template
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Scaffolding project…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(result: ScaffoldOutput): React.ReactNode {
  return (
    <MessageResponse height={2}>
      <Box flexDirection="column" gap={0}>
        <Box flexDirection="row" gap={1}>
          <Text color="success">✓</Text>
          <Text bold>{result.name}</Text>
          <Text dimColor>({result.template})</Text>
          <Text dimColor>{result.files_written} files</Text>
        </Box>
        <Text dimColor>{result.project_path}</Text>
      </Box>
    </MessageResponse>
  )
}

export function getToolUseSummary(
  input: Partial<{ template: string; name: string }> | undefined,
): string | null {
  if (!input?.template) return null
  return input.name ? `${input.template}/${input.name}` : input.template
}
