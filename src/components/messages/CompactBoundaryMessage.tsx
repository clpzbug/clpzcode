import { Box, Text } from '../../ink.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';

type CompactMeta = {
  preTokens?: number
  postTokens?: number
  messagesSummarized?: number
  trigger?: string
}

type Props = {
  message: { compactMetadata?: CompactMeta }
}

function fmtK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

export function CompactBoundaryMessage({ message }: Props) {
  const historyShortcut = useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o");
  const meta = message.compactMetadata;
  const preTokens = meta?.preTokens;
  const postTokens = meta?.postTokens;
  const messagesSummarized = meta?.messagesSummarized;

  const reductionPct = preTokens && postTokens && preTokens > 0
    ? ` (↓${Math.round((1 - postTokens / preTokens) * 100)}%)`
    : ''
  const tokenStr = preTokens && postTokens
    ? ` · ${fmtK(preTokens)} → ${fmtK(postTokens)} tokens${reductionPct}`
    : preTokens
      ? ` · ${fmtK(preTokens)} tokens`
      : ''
  const msgStr = messagesSummarized ? ` · ${messagesSummarized} msgs` : ''

  return <Box marginY={1}><Text dimColor={true}>✻ Conversation compacted{tokenStr}{msgStr} ({historyShortcut} for history)</Text></Box>;
}
