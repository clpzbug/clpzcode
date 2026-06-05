import React from 'react';
import type { DeepImmutable } from 'src/types/utils.js';
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useElapsedTime } from '../../hooks/useElapsedTime.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text, useTheme } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { getEmptyToolPermissionContext } from '../../Tool.js';
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js';
import { getTools } from '../../tools.js';
import { formatNumber } from '../../utils/format.js';
import { extractTag } from '../../utils/messages.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { UserPlanMessage } from '../messages/UserPlanMessage.js';
import { renderToolActivity } from './renderToolActivity.js';
import { getTaskStatusColor, getTaskStatusIcon } from './taskStatusUtils.js';
type Props = {
  agent: DeepImmutable<LocalAgentTaskState>;
  onDone: () => void;
  onKillAgent?: () => void;
  onBack?: () => void;
};
export function AsyncAgentDetailDialog({ agent, onDone, onKillAgent, onBack }: Props) {
  const [theme] = useTheme();
  const tools = getTools(getEmptyToolPermissionContext());
  const elapsedTime = useElapsedTime(agent.startTime, agent.status === "running", 1000, agent.totalPausedMs ?? 0);
  useKeybindings({
    "confirm:yes": onDone
  }, {
    context: "Confirmation"
  });
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === " ") {
      e.preventDefault();
      onDone();
    } else {
      if (e.key === "left" && onBack) {
        e.preventDefault();
        onBack();
      } else {
        if (e.key === "x" && agent.status === "running" && onKillAgent) {
          e.preventDefault();
          onKillAgent();
        }
      }
    }
  };
  const planContent = extractTag(agent.prompt, "plan");
  const displayPrompt = agent.prompt.length > 300 ? agent.prompt.substring(0, 297) + "…" : agent.prompt;
  const tokenCount = agent.result?.totalTokens ?? agent.progress?.tokenCount;
  const toolUseCount = agent.result?.totalToolUseCount ?? agent.progress?.toolUseCount;
  const title = <Text>{agent.selectedAgent?.agentType ?? "agent"} ›{" "}{agent.description || "Async agent"}</Text>;
  const subtitle = (
    <Text>
      {agent.status !== "running" && <Text color={getTaskStatusColor(agent.status)}>{getTaskStatusIcon(agent.status)}{" "}{agent.status === "completed" ? "Completed" : agent.status === "failed" ? "Failed" : "Stopped"}{" \xB7 "}</Text>}
      <Text dimColor={true}>{elapsedTime}{tokenCount !== undefined && tokenCount > 0 && <> · {formatNumber(tokenCount)} tokens</>}{toolUseCount !== undefined && toolUseCount > 0 && <>{" "}· {toolUseCount} {toolUseCount === 1 ? "tool" : "tools"}</>}</Text>
    </Text>
  );
  const inputGuide = (exitState: ExitState) => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>{onBack && <KeyboardShortcutHint shortcut={"←"} action="go back" />}<KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />{agent.status === "running" && onKillAgent && <KeyboardShortcutHint shortcut="x" action="stop" />}</Byline>;
  return (
    <Box flexDirection="column" tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>
      <Dialog title={title} subtitle={subtitle} onCancel={onDone} color="background" inputGuide={inputGuide}>
        <Box flexDirection="column">
          {agent.status === "running" && agent.progress?.recentActivities && agent.progress.recentActivities.length > 0 && <Box flexDirection="column"><Text bold={true} dimColor={true}>Progress</Text>{agent.progress.recentActivities.map((activity, i) => <Text key={i} dimColor={i < agent.progress!.recentActivities!.length - 1} wrap="truncate-end">{i === agent.progress!.recentActivities!.length - 1 ? "› " : "  "}{renderToolActivity(activity, tools, theme)}</Text>)}</Box>}
          {planContent ? <Box marginTop={1}><UserPlanMessage addMargin={false} planContent={planContent} /></Box> : <Box flexDirection="column" marginTop={1}><Text bold={true} dimColor={true}>Prompt</Text><Text wrap="wrap">{displayPrompt}</Text></Box>}
          {agent.status === "failed" && agent.error && <Box flexDirection="column" marginTop={1}><Text bold={true} color="error">Error</Text><Text color="error" wrap="wrap">{agent.error}</Text></Box>}
        </Box>
      </Dialog>
    </Box>
  );
}
