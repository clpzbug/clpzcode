import * as React from 'react'
import { pathToFileURL } from 'node:url'
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js'
import Link from '../../ink/components/Link.js'
import { supportsHyperlinks } from '../../ink/supports-hyperlinks.js'
import { SCAN_FRAMES } from '../../constants/animGlyphs.js'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { formatFileSize } from '../../utils/format.js'
import type { ScreenshotResult } from './utils.js'

export function renderToolUseMessage(
  input: Partial<{ url: string; width: number; height: number; full_page: boolean }>,
): React.ReactNode {
  if (!input?.url) return null
  const dims = input.width && input.height ? ` ${input.width}×${input.height}` : ''
  const full = input.full_page ? ' full' : ''
  return `${input.url}${dims}${full}`
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <AnimatedGlyph frames={SCAN_FRAMES} interval={100} loops={0} />
        <Text dimColor>Capturing screenshot…</Text>
      </Box>
    </MessageResponse>
  )
}

export function renderToolResultMessage(
  result: ScreenshotResult,
): React.ReactNode {
  const size = formatFileSize(result.bytes)
  const dims = `${result.width}×${result.height}`
  const ms = `${result.duration_ms}ms`

  const fileUrl = pathToFileURL(result.saved_path).href
  const pathDisplay = supportsHyperlinks() ? (
    <Link url={fileUrl}>
      <Text>{result.saved_path}</Text>
    </Link>
  ) : (
    <Text>{result.saved_path}</Text>
  )

  return (
    <MessageResponse height={1}>
      <Box flexDirection="row" gap={1}>
        <Text>Screenshot</Text>
        <Text bold>{dims}</Text>
        <Text dimColor>{size}</Text>
        <Text dimColor>{ms}</Text>
        <Text dimColor>→</Text>
        {pathDisplay}
      </Box>
    </MessageResponse>
  )
}

export function getToolUseSummary(
  input: Partial<{ url: string }> | undefined,
): string | null {
  return input?.url ?? null
}
