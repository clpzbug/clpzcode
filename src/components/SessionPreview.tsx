import type { UUID } from 'crypto';
import React, { useCallback } from 'react';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { getAllBaseTools } from '../tools.js';
import type { LogOption } from '../types/logs.js';
import { formatRelativeTimeAgo } from '../utils/format.js';
import { getSessionIdFromLog, isLiteLog, loadFullLog } from '../utils/sessionStorage.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Byline } from './design-system/Byline.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { LoadingState } from './design-system/LoadingState.js';
import { Messages } from './Messages.js';
type Props = {
  log: LogOption;
  onExit: () => void;
  onSelect: (log: LogOption) => void;
};
export function SessionPreview({ log, onExit, onSelect }: Props) {
  const [fullLog, setFullLog] = React.useState<LogOption | null>(null);
  React.useEffect(() => {
    setFullLog(null);
    if (isLiteLog(log)) {
      loadFullLog(log).then(setFullLog);
    }
  }, [log]);
  const isLoading = isLiteLog(log) && fullLog === null;
  const displayLog = fullLog ?? log;
  const conversationId = getSessionIdFromLog(displayLog) || "" as UUID;
  const tools = getAllBaseTools();
  useKeybinding("confirm:no", onExit, { context: "Confirmation" });
  const handleSelect = useCallback(() => {
    onSelect(fullLog ?? log);
  }, [fullLog, log, onSelect]);
  useKeybinding("confirm:yes", handleSelect, { context: "Confirmation" });
  if (isLoading) {
    return <Box flexDirection="column" padding={1}><LoadingState message={"Loading session…"} /><Text dimColor={true}><Byline><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline></Text></Box>;
  }
  const commands: never[] = [];
  const toolUseConfirmQueue: never[] = [];
  const inProgressToolUseIDs = new Set<string>();
  const streamingToolUses: never[] = [];
  const messages = <Messages messages={displayLog.messages} tools={tools} commands={commands} verbose={true} toolJSX={null} toolUseConfirmQueue={toolUseConfirmQueue} inProgressToolUseIDs={inProgressToolUseIDs} isMessageSelectorVisible={false} conversationId={conversationId} screen="transcript" streamingToolUses={streamingToolUses} showAllInTranscript={true} isLoading={false} />;
  const relativeTime = formatRelativeTimeAgo(displayLog.modified);
  const branch = displayLog.gitBranch ? ` · ${displayLog.gitBranch}` : "";
  return <Box flexDirection="column">{messages}<Box flexShrink={0} flexDirection="column" borderTopDimColor={true} borderBottom={false} borderLeft={false} borderRight={false} borderStyle="single" paddingLeft={2}><Text>{relativeTime} ·{" "}{displayLog.messageCount} messages{branch}</Text><Text dimColor={true}><Byline><KeyboardShortcutHint shortcut="Enter" action="resume" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline></Text></Box></Box>;
}
