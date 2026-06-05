import figures from 'figures';
import * as React from 'react';
import { useState } from 'react';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { stringWidth } from 'src/ink/stringWidth.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import { enterTeammateView, exitTeammateView } from 'src/state/teammateViewHelpers.js';
import { isPanelAgentTask } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import { getPillLabel, pillNeedsCta } from 'src/tasks/pillLabel.js';
import { type BackgroundTaskState, isBackgroundTask, type TaskState } from 'src/tasks/types.js';
import { calculateHorizontalScrollWindow } from 'src/utils/horizontalScroll.js';
import { Box, Text } from '../../ink.js';
import { AGENT_COLOR_TO_THEME_COLOR, AGENT_COLORS, type AgentColorName } from '../../tools/AgentTool/agentColorManager.js';
import type { Theme } from '../../utils/theme.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { shouldHideTasksFooter } from './taskStatusUtils.js';
type Props = {
  tasksSelected: boolean;
  isViewingTeammate?: boolean;
  teammateFooterIndex?: number;
  isLeaderIdle?: boolean;
  onOpenDialog?: (taskId?: string) => void;
};
export function BackgroundTaskStatus({
  tasksSelected,
  isViewingTeammate,
  teammateFooterIndex = 0,
  isLeaderIdle = false,
  onOpenDialog
}: Props) {
  const setAppState = useSetAppState();
  const {
    columns
  } = useTerminalSize();
  const tasks = useAppState(s => s.tasks);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const runningTasks = (Object.values(tasks ?? {}) as TaskState[]).filter(t => isBackgroundTask(t) && !(false && isPanelAgentTask(t)));
  const expandedView = useAppState(s => s.expandedView);
  const showSpinnerTree = expandedView === "teammates";
  const allTeammates = !showSpinnerTree && runningTasks.length > 0 && runningTasks.every(t => t.type === "in_process_teammate");
  const teammateEntries = runningTasks.filter(t => t.type === "in_process_teammate").sort((a, b) => a.identity.agentName.localeCompare(b.identity.agentName));
  const mainPill = {
    name: "main",
    color: undefined as keyof Theme | undefined,
    isIdle: isLeaderIdle,
    taskId: undefined as string | undefined
  };
  const teammatePills = teammateEntries.map(t => ({
    name: t.identity.agentName,
    color: getAgentThemeColor(t.identity.color),
    isIdle: t.isIdle,
    taskId: t.id
  }));
  if (!tasksSelected) {
    teammatePills.sort((a, b) => {
      if (a.isIdle !== b.isIdle) {
        return a.isIdle ? 1 : -1;
      }
      return 0;
    });
  }
  const pills = [mainPill, ...teammatePills];
  const allPills = pills.map((pill, i) => ({
    ...pill,
    idx: i
  }));
  const pillWidths = allPills.map((pill, i) => {
    const pillText = `@${pill.name}`;
    return stringWidth(pillText) + (i > 0 ? 1 : 0);
  });
  if (allTeammates || !showSpinnerTree && isViewingTeammate) {
    const selectedIdx = tasksSelected ? teammateFooterIndex : -1;
    const viewedIdx = viewingAgentTaskId ? teammateEntries.findIndex(t => t.id === viewingAgentTaskId) + 1 : 0;
    const availableWidth = Math.max(20, columns - 20 - 4);
    const {
      startIndex,
      endIndex,
      showLeftArrow,
      showRightArrow
    } = calculateHorizontalScrollWindow(pillWidths, availableWidth, 2, selectedIdx >= 0 ? selectedIdx : 0);
    const visiblePills = allPills.slice(startIndex, endIndex);
    return <>{showLeftArrow && <Text dimColor={true}>{figures.arrowLeft} </Text>}{visiblePills.map((pill, i) => {
      const needsSeparator = i > 0;
      return <React.Fragment key={pill.name}>{needsSeparator && <Text> </Text>}<AgentPill name={pill.name} color={pill.color} isSelected={selectedIdx === pill.idx} isViewed={viewedIdx === pill.idx} isIdle={pill.isIdle} onClick={() => pill.taskId ? enterTeammateView(pill.taskId, setAppState) : exitTeammateView(setAppState)} /></React.Fragment>;
    })}{showRightArrow && <Text dimColor={true}> {figures.arrowRight}</Text>}<Text dimColor={true}>{" \xB7 "}<KeyboardShortcutHint shortcut={"shift + ↓"} action="expand" /></Text></>;
  }
  if (shouldHideTasksFooter(tasks ?? {}, showSpinnerTree)) {
    return null;
  }
  if (runningTasks.length === 0) {
    return null;
  }
  const label = getPillLabel(runningTasks);
  return <><SummaryPill selected={tasksSelected} onClick={onOpenDialog}>{label}</SummaryPill>{pillNeedsCta(runningTasks) && <Text dimColor={true}> · {figures.arrowDown} to view</Text>}</>;
}
type AgentPillProps = {
  name: string;
  color?: keyof Theme;
  isSelected: boolean;
  isViewed: boolean;
  isIdle: boolean;
  onClick?: () => void;
};
function AgentPill({
  name,
  color,
  isSelected,
  isViewed,
  isIdle,
  onClick
}: AgentPillProps) {
  const [hover, setHover] = useState(false);
  const highlighted = isSelected || hover;
  let label;
  if (highlighted) {
    label = color ? <Text backgroundColor={color} color="inverseText" bold={isViewed}>@{name}</Text> : <Text color="background" inverse={true} bold={isViewed}>@{name}</Text>;
  } else {
    if (isIdle) {
      label = <Text dimColor={true} bold={isViewed}>@{name}</Text>;
    } else {
      if (isViewed) {
        label = <Text color={color} bold={true}>@{name}</Text>;
      } else {
        label = <Text color={color} dimColor={!color}>@{name}</Text>;
      }
    }
  }
  if (!onClick) {
    return label;
  }
  return <Box onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>{label}</Box>;
}
type SummaryPillProps = {
  selected: boolean;
  onClick?: () => void;
  children: React.ReactNode;
};
function SummaryPill({
  selected,
  onClick,
  children
}: SummaryPillProps) {
  const [hover, setHover] = useState(false);
  const label = <Text color="background" inverse={selected || hover}>{children}</Text>;
  if (!onClick) {
    return label;
  }
  return <Box onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>{label}</Box>;
}
function getAgentThemeColor(colorName: string | undefined): keyof Theme | undefined {
  if (!colorName) return undefined;
  if (AGENT_COLORS.includes(colorName as AgentColorName)) {
    return AGENT_COLOR_TO_THEME_COLOR[colorName as AgentColorName];
  }
  return undefined;
}
