import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import { UPLOAD_FRAMES } from '../../constants/animGlyphs.js'
import type { HTTPMethod, HTTPResponse } from './utils.js'

const METHOD_COLORS: Record<HTTPMethod, string> = {
  GET: 'green',
  POST: 'blue',
  PUT: 'yellow',
  PATCH: 'cyan',
  DELETE: 'red',
  HEAD: 'gray',
}

function statusColor(status: number): 'success' | 'warning' | 'error' {
  if (status < 300) return 'success'
  if (status < 400) return 'warning'
  return 'error'
}

export function renderToolUseMessage(
  input: Partial<{ method: string; url: string }>,
): React.ReactNode {
  if (!input?.url) return null
  const method = input.method ?? 'GET'
  return `${method} ${input.url}`
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={UPLOAD_FRAMES} interval={80} loops={0} />
        <Text dimColor>Sending request…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(result: HTTPResponse): React.ReactNode {
  const color = statusColor(result.status)
  const ms = `${result.duration_ms}ms`
  const truncNote = result.truncated
    ? ` (truncated from ${result.body_bytes} bytes)`
    : ''

  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={color} bold>{result.status}</Text>
        <Text dimColor>{result.status_text}</Text>
        <Text dimColor>·</Text>
        <Text dimColor>{ms}</Text>
        {result.truncated && <Text color="warning">{truncNote}</Text>}
        {result.redirected && <Text dimColor>(redirected)</Text>}
      </Box>
    </MessageResponse>
  )
}

export function getToolUseSummary(
  input: Partial<{ method: string; url: string }> | undefined,
): string | null {
  if (!input?.url) return null
  const method = input.method ?? 'GET'
  return `${method} ${input.url}`
}
