import React from 'react';
import { AnimatedGlyph } from '../../components/AnimatedGlyph.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { UPLOAD_FRAMES, FOUND_FRAMES } from '../../constants/animGlyphs.js';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js';
import { Box, Text } from '../../ink.js';
import type { ProgressMessage } from '../../types/message.js';
import { truncate } from '../../utils/format.js';
import type { Output, SearchResult, WebSearchProgress } from './WebSearchTool.js';
function getSearchSummary(results: (SearchResult | string | null | undefined)[]): {
  searchCount: number;
  totalResultCount: number;
} {
  let searchCount = 0;
  let totalResultCount = 0;
  for (const result of results) {
    if (result != null && typeof result !== 'string') {
      searchCount++;
      totalResultCount += result.content?.length ?? 0;
    }
  }
  return {
    searchCount,
    totalResultCount
  };
}
export function renderToolUseMessage({
  query,
  allowed_domains,
  blocked_domains
}: Partial<{
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}>, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!query) {
    return null;
  }
  let message = '';
  if (query) {
    message += `"${query}"`;
  }
  if (verbose) {
    if (allowed_domains && allowed_domains.length > 0) {
      message += `, only allowing domains: ${allowed_domains.join(', ')}`;
    }
    if (blocked_domains && blocked_domains.length > 0) {
      message += `, blocking domains: ${blocked_domains.join(', ')}`;
    }
  }
  return message;
}
export function renderToolUseProgressMessage(progressMessages: ProgressMessage<WebSearchProgress>[]): React.ReactNode {
  if (progressMessages.length === 0) {
    return (
      <MessageResponse height={1}>
        <Box flexDirection="row" gap={1}>
          <AnimatedGlyph frames={UPLOAD_FRAMES} interval={80} loops={0} />
          <Text dimColor>Searching…</Text>
        </Box>
      </MessageResponse>
    )
  }
  const lastProgress = progressMessages[progressMessages.length - 1];
  if (!lastProgress?.data) {
    return null;
  }
  const data = lastProgress.data;
  switch (data.type) {
    case 'query_update':
      return (
        <MessageResponse height={1}>
          <Box flexDirection="row" gap={1}>
            <AnimatedGlyph frames={UPLOAD_FRAMES} interval={80} loops={0} />
            <Text dimColor>Searching: {data.query}</Text>
          </Box>
        </MessageResponse>
      )
    case 'search_results_received':
      return (
        <MessageResponse height={1}>
          <Box flexDirection="row" gap={1}>
            <AnimatedGlyph frames={FOUND_FRAMES} interval={80} loops={1} settle="⠂" />
            <Text dimColor>Found {data.resultCount} results for &quot;{data.query}&quot;</Text>
          </Box>
        </MessageResponse>
      )
    default:
      return null;
  }
}
export function renderToolResultMessage(output: Output): React.ReactNode {
  const {
    searchCount
  } = getSearchSummary(output.results ?? []);
  const timeDisplay = output.durationSeconds >= 1 ? `${Math.round(output.durationSeconds)}s` : `${Math.round(output.durationSeconds * 1000)}ms`;
  return <Box justifyContent="space-between" width="100%">
      <MessageResponse height={1}>
        <Text>
          Did {searchCount} search
          {searchCount !== 1 ? 'es' : ''} in {timeDisplay}
        </Text>
      </MessageResponse>
    </Box>;
}
export function getToolUseSummary(input: Partial<{
  query: string;
}> | undefined): string | null {
  if (!input?.query) {
    return null;
  }
  return truncate(input.query, TOOL_SUMMARY_MAX_LENGTH);
}
