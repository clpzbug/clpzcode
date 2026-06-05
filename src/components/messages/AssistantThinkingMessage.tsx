import type { ThinkingBlock, ThinkingBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { Box, Text } from '../../ink.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { Markdown } from '../Markdown.js';
type Props = {
  // Accept either full ThinkingBlock/ThinkingBlockParam or a minimal shape with just type and thinking
  param: ThinkingBlock | ThinkingBlockParam | {
    type: 'thinking';
    thinking: string;
  };
  addMargin: boolean;
  isTranscriptMode: boolean;
  verbose: boolean;
  /** When true, hide this thinking block entirely (used for past thinking in transcript mode) */
  hideInTranscript?: boolean;
};
export function AssistantThinkingMessage({
  param,
  addMargin = false,
  isTranscriptMode,
  verbose,
  hideInTranscript = false
}: Props) {
  const { thinking } = param;
  if (!thinking) {
    return null;
  }
  if (hideInTranscript) {
    return null;
  }
  const shouldShowFullThinking = isTranscriptMode || verbose;
  if (!shouldShowFullThinking) {
    return <Box marginTop={addMargin ? 1 : 0}><Text dimColor={true} italic={true}>{"∴ Thinking"} <CtrlOToExpand /></Text></Box>;
  }
  return <Box flexDirection="column" gap={1} marginTop={addMargin ? 1 : 0} width="100%"><Text dimColor={true} italic={true}>{"∴ Thinking"}…</Text><Box paddingLeft={2}><Markdown dimColor={true}>{thinking}</Markdown></Box></Box>;
}
