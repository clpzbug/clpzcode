import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { PROBE_FRAMES } from '../../constants/animGlyphs.js'
import type { Output } from './SQLiTool.js'

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={PROBE_FRAMES} interval={200} loops={0} />
        <Text dimColor>Injecting…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(content: Output): React.ReactNode {
  if (content.error && !content.vulnerable) {
    return (
      <MessageResponse height={1}>
        <Text color="error">Scan error</Text>
      </MessageResponse>
    )
  }
  if (!content.vulnerable) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>Not vulnerable</Text>
      </MessageResponse>
    )
  }
  const parts: string[] = []
  if (content.databases?.length) parts.push(`${content.databases.length} DB`)
  const tableCount = Object.values(content.tables ?? {}).reduce((s, t) => s + t.length, 0)
  if (tableCount) parts.push(`${tableCount} tables`)
  return (
    <MessageResponse height={1}>
      <Text>Vulnerable{parts.length ? ` · ${parts.join(' · ')}` : ''}</Text>
    </MessageResponse>
  )
}
