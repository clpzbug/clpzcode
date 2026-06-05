// biome-ignore-all assist/source/organizeImports: internal-only import markers must not be reordered
import { Box, Text, type TextProps } from '../../ink.js';
const HOOK_TIMING_DISPLAY_THRESHOLD_MS = Infinity  // ant-internal threshold, always skip in open-source
import { feature } from 'bun:bundle';
import * as React from 'react';
import { useState } from 'react';
import sample from 'lodash-es/sample.js';
import { BLACK_CIRCLE, REFERENCE_MARK } from '../../constants/figures.js';
import { AnimatedGlyph } from '../AnimatedGlyph.js';
import { DONE_FRAMES, IDLE_FRAMES, THINK_FRAMES, TASK_FIRE_FRAMES, PERMISSION_FRAMES } from '../../constants/animGlyphs.js';
import figures from 'figures';
import { basename } from 'path';
import { MessageResponse } from '../MessageResponse.js';
import { FilePathLink } from '../FilePathLink.js';
import { openPath } from '../../utils/browser.js';
/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemSaved = feature('TEAMMEM') ? require('./teamMemSaved.js') as typeof import('./teamMemSaved.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */
import { TURN_COMPLETION_VERBS } from '../../constants/turnCompletionVerbs.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { SystemMessage, SystemStopHookSummaryMessage, SystemBridgeStatusMessage, SystemTurnDurationMessage, SystemThinkingMessage, SystemMemorySavedMessage } from '../../types/message.js';
import { SystemAPIErrorMessage } from './SystemAPIErrorMessage.js';
import { formatDuration, formatNumber, formatSecondsShort } from '../../utils/format.js';
import { getGlobalConfig } from '../../utils/config.js';
import Link from '../../ink/components/Link.js';
import ThemedText from '../design-system/ThemedText.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { useAppStateStore } from '../../state/AppState.js';
import { isBackgroundTask, type TaskState } from '../../tasks/types.js';
import { getPillLabel } from '../../tasks/pillLabel.js';
import { useSelectedMessageBg } from '../messageActions.js';
type Props = {
  message: SystemMessage;
  addMargin: boolean;
  verbose: boolean;
  isTranscriptMode?: boolean;
};
export function SystemTextMessage({ message, addMargin, verbose, isTranscriptMode }: Props) {
  const bg = useSelectedMessageBg();
  if (message.subtype === "turn_duration") {
    return <TurnDurationMessage message={message} addMargin={addMargin} />;
  }
  if (message.subtype === "memory_saved") {
    return <MemorySavedMessage message={message} addMargin={addMargin} />;
  }
  if (message.subtype === "away_summary") {
    return (
      <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <Box minWidth={2}><Text dimColor={true}>{REFERENCE_MARK}</Text></Box>
        <Text dimColor={true}>{message.content}</Text>
      </Box>
    );
  }
  if (message.subtype === "agents_killed") {
    return (
      <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <Box minWidth={2}><Text color="error">{BLACK_CIRCLE}</Text></Box>
        <Text dimColor={true}>All background agents stopped</Text>
      </Box>
    );
  }
  if (message.subtype === "thinking") {
    return null;
  }
  if (message.subtype === "bridge_status") {
    return <BridgeStatusMessage message={message} addMargin={addMargin} />;
  }
  if (message.subtype === "scheduled_task_fire") {
    return (
      <Box marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <Box flexDirection="row"><AnimatedGlyph frames={TASK_FIRE_FRAMES} interval={100} loops={1} settle="⠀" /><Text dimColor={true}> {message.content}</Text></Box>
      </Box>
    );
  }
  if (message.subtype === "permission_retry") {
    return (
      <Box marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <AnimatedGlyph frames={PERMISSION_FRAMES} interval={80} loops={1} settle="⠀" />
        <Text> Allowed </Text>
        <Text bold={true}>{message.commands.join(", ")}</Text>
      </Box>
    );
  }
  const isStopHookSummary = message.subtype === "stop_hook_summary";
  if (!isStopHookSummary && !verbose && message.level === "info") {
    return null;
  }
  if (message.subtype === "api_error") {
    return <SystemAPIErrorMessage message={message} verbose={verbose} />;
  }
  if (message.subtype === "stop_hook_summary") {
    return <StopHookSummaryMessage message={message} addMargin={addMargin} verbose={verbose} isTranscriptMode={isTranscriptMode} />;
  }
  const content = message.content;
  if (typeof content !== "string") {
    return null;
  }
  return (
    <Box flexDirection="row" width="100%">
      <SystemTextMessageInner
        content={content}
        addMargin={addMargin}
        dot={message.level !== "info"}
        color={message.level === "warning" ? "warning" : undefined}
        dimColor={message.level === "info"}
      />
    </Box>
  );
}
function StopHookSummaryMessage({ message, addMargin, verbose, isTranscriptMode }: Props) {
  const bg = useSelectedMessageBg();
  const {
    hookCount,
    hookInfos,
    hookErrors,
    preventedContinuation,
    stopReason
  } = message;
  const {
    columns
  } = useTerminalSize();
  const totalDurationMs = message.totalDurationMs ?? hookInfos.reduce((sum, h) => sum + (h.durationMs ?? 0), 0);
  if (hookErrors.length === 0 && !preventedContinuation && !message.hookLabel) {
    if (true || totalDurationMs < HOOK_TIMING_DISPLAY_THRESHOLD_MS) {
      return null;
    }
  }
  const totalStr = false && totalDurationMs > 0 ? ` (${formatSecondsShort(totalDurationMs)})` : "";
  if (message.hookLabel) {
    return (
      <Box flexDirection="column" width="100%">
        <Text dimColor={true}>{"  └  "}Ran {hookCount} {message.hookLabel}{" "}{hookCount === 1 ? "hook" : "hooks"}{totalStr}</Text>
        {isTranscriptMode && hookInfos.map((info, idx) => {
          const durationStr = false && info.durationMs !== undefined ? ` (${formatSecondsShort(info.durationMs)})` : "";
          return <Text key={`cmd-${idx}`} dimColor={true}>{"     └ "}{info.command === "prompt" ? `prompt: ${info.promptText || ""}` : info.command}{durationStr}</Text>;
        })}
      </Box>
    );
  }
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
      <Box minWidth={2}><Text>{BLACK_CIRCLE}</Text></Box>
      <Box flexDirection="column" width={columns - 10}>
        <Text>Ran <Text bold={true}>{hookCount}</Text> {message.hookLabel ?? "stop"}{" "}{hookCount === 1 ? "hook" : "hooks"}{totalStr}{!verbose && hookInfos.length > 0 && <>{" "}<CtrlOToExpand /></>}</Text>
        {verbose && hookInfos.length > 0 && hookInfos.map((info, idx) => {
          const durationStr = false && info.durationMs !== undefined ? ` (${formatSecondsShort(info.durationMs)})` : "";
          return <Text key={`cmd-${idx}`} dimColor={true}>└  {info.command === "prompt" ? `prompt: ${info.promptText || ""}` : info.command}{durationStr}</Text>;
        })}
        {preventedContinuation && stopReason && <Text><Text dimColor={true}>└  </Text>{stopReason}</Text>}
        {hookErrors.length > 0 && hookErrors.map((err, idx_1) => <Text key={idx_1}><Text dimColor={true}>└  </Text>{message.hookLabel ?? "Stop"} hook error: {err}</Text>)}
      </Box>
    </Box>
  );
}
type SystemTextMessageInnerProps = {
  content: string;
  addMargin: boolean;
  dot: boolean;
  color: TextProps['color'];
  dimColor: boolean;
};
function SystemTextMessageInner({ content, addMargin, dot, color, dimColor }: SystemTextMessageInnerProps) {
  const {
    columns
  } = useTerminalSize();
  const bg = useSelectedMessageBg();
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
      {dot && <Box minWidth={2}><Text color={color} dimColor={dimColor}>{BLACK_CIRCLE}</Text></Box>}
      <Box flexDirection="column" width={columns - 10}>
        <Text color={color} dimColor={dimColor} wrap="wrap">{content.trim()}</Text>
      </Box>
    </Box>
  );
}
type TurnDurationMessageProps = {
  message: SystemTurnDurationMessage;
  addMargin: boolean;
};
function TurnDurationMessage({ message, addMargin }: TurnDurationMessageProps) {
  const bg = useSelectedMessageBg();
  const [verb] = useState(() => sample(TURN_COMPLETION_VERBS) ?? "Worked");
  const store = useAppStateStore();
  const [backgroundTaskSummary] = useState(() => {
    const tasks = store.getState().tasks;
    const running = (Object.values(tasks ?? {}) as TaskState[]).filter(isBackgroundTask);
    return running.length > 0 ? getPillLabel(running) : null;
  });
  const showTurnDuration = getGlobalConfig().showTurnDuration ?? true;
  const duration = formatDuration(message.durationMs);
  const hasBudget = message.budgetLimit !== undefined;
  let budgetSuffix: string;
  if (!hasBudget) {
    budgetSuffix = "";
  } else {
    const tokens = message.budgetTokens;
    const limit = message.budgetLimit;
    const usage = tokens >= limit ? `${formatNumber(tokens)} used (${formatNumber(limit)} min ${figures.tick})` : `${formatNumber(tokens)} / ${formatNumber(limit)} (${Math.round(tokens / limit * 100)}%)`;
    const nudges = message.budgetNudges > 0 ? ` · ${message.budgetNudges} ${message.budgetNudges === 1 ? "nudge" : "nudges"}` : "";
    budgetSuffix = `${showTurnDuration ? " \xB7 " : ""}${usage}${nudges}`;
  }
  if (!showTurnDuration && !hasBudget) {
    return null;
  }
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
      <Box minWidth={2}><AnimatedGlyph frames={DONE_FRAMES} interval={90} loops={1} settle="⠀" /></Box>
      <Text dimColor={true}>{showTurnDuration && `${verb} for ${duration}`}{budgetSuffix}{backgroundTaskSummary && ` · ${backgroundTaskSummary} still running`}</Text>
    </Box>
  );
}
type MemorySavedMessageProps = {
  message: SystemMemorySavedMessage;
  addMargin: boolean;
};
function MemorySavedMessage({ message, addMargin }: MemorySavedMessageProps) {
  const bg = useSelectedMessageBg();
  const {
    writtenPaths
  } = message;
  const team = feature("TEAMMEM") ? teamMemSaved!.teamMemSavedPart(message) : null;
  const privateCount = writtenPaths.length - (team?.count ?? 0);
  const parts = [
    privateCount > 0 ? `${privateCount} ${privateCount === 1 ? "memory" : "memories"}` : null,
    team?.segment
  ].filter(Boolean);
  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor={bg}>
      <Box flexDirection="row"><Box minWidth={2}><Text dimColor={true}>{BLACK_CIRCLE}</Text></Box><Text>{message.verb ?? "Saved"} {parts.join(" \xB7 ")}</Text></Box>
      {writtenPaths.map((p: string) => <MemoryFileRow key={p} path={p} />)}
    </Box>
  );
}
function MemoryFileRow({ path }: { path: string }) {
  const [hover, setHover] = useState(false);
  return (
    <MessageResponse>
      <Box onClick={() => void openPath(path)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <Text dimColor={!hover} underline={hover}>
          <FilePathLink filePath={path}>{basename(path)}</FilePathLink>
        </Text>
      </Box>
    </MessageResponse>
  );
}
type ThinkingMessageProps = {
  message: SystemThinkingMessage;
  addMargin: boolean;
};
function ThinkingMessage({ message, addMargin }: ThinkingMessageProps) {
  const bg = useSelectedMessageBg();
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
      <Box minWidth={2}><AnimatedGlyph frames={THINK_FRAMES} interval={80} loops={0} /></Box>
      <Text dimColor={true}>{message.content}</Text>
    </Box>
  );
}
type BridgeStatusMessageProps = {
  message: SystemBridgeStatusMessage;
  addMargin: boolean;
};
function BridgeStatusMessage({ message, addMargin }: BridgeStatusMessageProps) {
  const bg = useSelectedMessageBg();
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width={999}>
      <Box minWidth={2} />
      <Box flexDirection="column">
        <Text><ThemedText color="suggestion">/remote-control</ThemedText> is active. Code in CLI or at</Text>
        <Link url={message.url}>{message.url}</Link>
        {message.upgradeNudge && <Text dimColor={true}>└ {message.upgradeNudge}</Text>}
      </Box>
    </Box>
  );
}
