import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import type { ColorOutput } from './ColorTool.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'


export function renderToolUseMessage(
  input: Partial<{ action: string; color: string; color2: string }>,
): React.ReactNode {
  if (!input?.action) return null
  const parts = [input.action, input.color, input.color2 ? `↔ ${input.color2}` : null].filter(Boolean)
  return parts.join(' ')
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Computing color…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(result: ColorOutput): React.ReactNode {
  if (result.action === 'contrast') {
    const ratingColor =
      result.rating === 'AAA' ? 'success' : result.rating === 'AA' ? 'ansi:cyan' : result.rating === 'AA Large' ? 'warning' : 'error'
    return (
      <MessageResponse height={1}>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>contrast</Text>
          <Text bold>{result.ratio}:1</Text>
          <Text color={ratingColor} bold>{result.rating}</Text>
        </Box>
      </MessageResponse>
    )
  }

  if (result.action === 'palette') {
    return (
      <MessageResponse height={1}>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>palette</Text>
          <Text bold>{result.name}</Text>
          <Text dimColor>11 shades →</Text>
          <Text dimColor>{result.export_format}</Text>
        </Box>
      </MessageResponse>
    )
  }

  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{result.action}</Text>
        {'result' in result && <Text bold>{String(result.result)}</Text>}
      </Box>
    </MessageResponse>
  )
}

export function getToolUseSummary(
  input: Partial<{ action: string; color: string }> | undefined,
): string | null {
  if (!input?.action) return null
  return input.color ? `${input.action} ${input.color}` : input.action
}
