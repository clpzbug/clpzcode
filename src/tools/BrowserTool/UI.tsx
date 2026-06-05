import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import { formatFileSize } from '../../utils/format.js'
import type { BrowserOutput } from './BrowserTool.js'


export function renderToolUseMessage(
  input: Partial<{ action: string; url: string; selector: string; text: string }>,
): React.ReactNode {
  if (!input?.action) return null
  const detail = input.url ?? input.selector ?? input.text ?? ''
  return detail ? `${input.action} ${detail}` : input.action
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Automating browser…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(result: BrowserOutput): React.ReactNode {
  if (result.action === 'screenshot' && result.bytes) {
    return (
      <MessageResponse height={1}>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>screenshot</Text>
          <Text dimColor>{formatFileSize(result.bytes)}</Text>
          {result.saved_path && <Text dimColor>→ {result.saved_path}</Text>}
        </Box>
      </MessageResponse>
    )
  }

  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{result.action}</Text>
        <Text color="success">✓</Text>
        {result.url && <Text dimColor>{result.url}</Text>}
      </Box>
    </MessageResponse>
  )
}

export function getToolUseSummary(
  input: Partial<{ action: string; url: string; selector: string }> | undefined,
): string | null {
  if (!input?.action) return null
  const detail = input.url ?? input.selector ?? ''
  return detail ? `${input.action} ${detail}` : input.action
}
