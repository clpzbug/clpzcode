import figures from 'figures';
import * as React from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text, useAnimationFrame } from '../ink.js';
import { useAppState } from '../state/AppState.js';
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js';
import { AGENT_COLOR_TO_THEME_COLOR, type AgentColorName } from '../tools/AgentTool/agentColorManager.js';
import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js';
import { count } from '../utils/array.js';
import { summarizeRecentActivities } from '../utils/collapseReadSearch.js';
import { truncateToWidth } from '../utils/format.js';
import { isTodoV2Enabled, type Task } from '../utils/tasks.js';
import type { Theme } from '../utils/theme.js';
import FullWidthRow from './design-system/FullWidthRow.js';
import ThemedText from './design-system/ThemedText.js';
import { MessageResponseContext, MESSAGE_RESPONSE_PREFIX_WIDTH } from './MessageResponse.js';
type Props = {
  tasks: Task[];
  isStandalone?: boolean;
};
const RECENT_COMPLETED_TTL_MS = 30_000;
function byIdAsc(a: Task, b: Task): number {
  const aNum = parseInt(a.id, 10);
  const bNum = parseInt(b.id, 10);
  if (!isNaN(aNum) && !isNaN(bNum)) {
    return aNum - bNum;
  }
  return a.id.localeCompare(b.id);
}
export function TaskListV2({
  tasks,
  isStandalone = false
}: Props): React.ReactNode {
  const teamContext = useAppState(s => s.teamContext);
  const appStateTasks = useAppState(s_0 => s_0.tasks);
  const [, forceUpdate] = React.useState(0);
  const {
    rows,
    columns
  } = useTerminalSize();
  // When inside a MessageResponse the "  └  " prefix consumes 5 columns.
  // Subtract that from column calculations so subjects truncate correctly
  // and FullWidthRow trailing IDs don't wrap or collide with adjacent rows.
  const isInMessageResponse = React.useContext(MessageResponseContext);
  const effectiveColumns = isInMessageResponse ? columns - MESSAGE_RESPONSE_PREFIX_WIDTH : columns;

  // Track when each task was last observed transitioning to completed
  const completionTimestampsRef = React.useRef(new Map<string, number>());
  const previousCompletedIdsRef = React.useRef<Set<string> | null>(null);
  if (previousCompletedIdsRef.current === null) {
    previousCompletedIdsRef.current = new Set(tasks.filter(t => t.status === 'completed').map(t_0 => t_0.id));
  }
  const maxDisplay = rows <= 10 ? 0 : Math.min(10, Math.max(3, rows - 14));

  // Update completion timestamps: reset when a task transitions to completed
  const currentCompletedIds = new Set(tasks.filter(t_1 => t_1.status === 'completed').map(t_2 => t_2.id));
  const now = Date.now();
  for (const id of currentCompletedIds) {
    if (!previousCompletedIdsRef.current.has(id)) {
      completionTimestampsRef.current.set(id, now);
    }
  }
  for (const id_0 of completionTimestampsRef.current.keys()) {
    if (!currentCompletedIds.has(id_0)) {
      completionTimestampsRef.current.delete(id_0);
    }
  }
  previousCompletedIdsRef.current = currentCompletedIds;

  // Schedule re-render when the next recent completion expires.
  // Depend on `tasks` so the timer is only reset when the task list changes,
  // not on every render (which was causing unnecessary work).
  React.useEffect(() => {
    if (completionTimestampsRef.current.size === 0) {
      return;
    }
    const currentNow = Date.now();
    let earliestExpiry = Infinity;
    for (const ts of completionTimestampsRef.current.values()) {
      const expiry = ts + RECENT_COMPLETED_TTL_MS;
      if (expiry > currentNow && expiry < earliestExpiry) {
        earliestExpiry = expiry;
      }
    }
    if (earliestExpiry === Infinity) {
      return;
    }
    const timer = setTimeout(forceUpdate_0 => forceUpdate_0((n: number) => n + 1), earliestExpiry - currentNow, forceUpdate);
    return () => clearTimeout(timer);
  }, [tasks]);
  if (!isTodoV2Enabled()) {
    return null;
  }
  if (tasks.length === 0) {
    return null;
  }

  // Build a map of teammate name -> theme color
  const teammateColors: Record<string, keyof Theme> = {};
  if (isAgentSwarmsEnabled() && teamContext?.teammates) {
    for (const teammate of Object.values(teamContext.teammates) as any[]) {
      if (teammate.color) {
        const themeColor = AGENT_COLOR_TO_THEME_COLOR[teammate.color as AgentColorName];
        if (themeColor) {
          teammateColors[teammate.name] = themeColor;
        }
      }
    }
  }

  // Build a map of teammate name -> current activity description
  // Map both agentName ("researcher") and agentId ("researcher@team") so
  // task owners match regardless of which format the model used.
  // Rolls up consecutive search/read tool uses into a compact summary.
  // Also track which teammates are still running (not shut down).
  const teammateActivity: Record<string, string> = {};
  const activeTeammates = new Set<string>();
  if (isAgentSwarmsEnabled()) {
    for (const bgTask of Object.values(appStateTasks)) {
      if (isInProcessTeammateTask(bgTask) && bgTask.status === 'running') {
        activeTeammates.add(bgTask.identity.agentName);
        activeTeammates.add(bgTask.identity.agentId);
        const activities = bgTask.progress?.recentActivities;
        const desc = (activities && summarizeRecentActivities(activities)) ?? bgTask.progress?.lastActivity?.activityDescription;
        if (desc) {
          teammateActivity[bgTask.identity.agentName] = desc;
          teammateActivity[bgTask.identity.agentId] = desc;
        }
      }
    }
  }

  // Get task counts for display
  const completedCount = count(tasks, t_3 => t_3.status === 'completed');
  const pendingCount = count(tasks, t_4 => t_4.status === 'pending');
  const inProgressCount = tasks.length - completedCount - pendingCount;
  // Unresolved tasks (open or in_progress) block dependent tasks
  const unresolvedTaskIds = new Set(tasks.filter(t_5 => t_5.status !== 'completed').map(t_6 => t_6.id));

  // Check if we need to truncate
  const needsTruncation = tasks.length > maxDisplay;
  let visibleTasks: Task[];
  let hiddenTasks: Task[];
  if (needsTruncation) {
    // Prioritize: recently completed (within 30s), in-progress, pending, older completed
    const recentCompleted: Task[] = [];
    const olderCompleted: Task[] = [];
    for (const task of tasks.filter(t_7 => t_7.status === 'completed')) {
      const ts_0 = completionTimestampsRef.current.get(task.id);
      if (ts_0 && now - ts_0 < RECENT_COMPLETED_TTL_MS) {
        recentCompleted.push(task);
      } else {
        olderCompleted.push(task);
      }
    }
    recentCompleted.sort(byIdAsc);
    olderCompleted.sort(byIdAsc);
    const inProgress = tasks.filter(t_8 => t_8.status === 'in_progress').sort(byIdAsc);
    const pending = tasks.filter(t_9 => t_9.status === 'pending').sort((a, b) => {
      const aBlocked = a.blockedBy.some(id_1 => unresolvedTaskIds.has(id_1));
      const bBlocked = b.blockedBy.some(id_2 => unresolvedTaskIds.has(id_2));
      if (aBlocked !== bBlocked) {
        return aBlocked ? 1 : -1;
      }
      return byIdAsc(a, b);
    });
    const prioritized = [...recentCompleted, ...inProgress, ...pending, ...olderCompleted];
    visibleTasks = prioritized.slice(0, maxDisplay);
    hiddenTasks = prioritized.slice(maxDisplay);
  } else {
    // No truncation needed — sort by ID for stable ordering
    visibleTasks = [...tasks].sort(byIdAsc);
    hiddenTasks = [];
  }
  let hiddenSummary = '';
  if (hiddenTasks.length > 0) {
    const parts: string[] = [];
    const hiddenPending = count(hiddenTasks, t_10 => t_10.status === 'pending');
    const hiddenInProgress = count(hiddenTasks, t_11 => t_11.status === 'in_progress');
    const hiddenCompleted = count(hiddenTasks, t_12 => t_12.status === 'completed');
    if (hiddenInProgress > 0) {
      parts.push(`${hiddenInProgress} in progress`);
    }
    if (hiddenPending > 0) {
      parts.push(`${hiddenPending} pending`);
    }
    if (hiddenCompleted > 0) {
      parts.push(`${hiddenCompleted} completed`);
    }
    hiddenSummary = ` … +${parts.join(', ')}`;
  }
  const content = <>
      {visibleTasks.map(task_0 => <TaskItem key={task_0.id} task={task_0} ownerColor={task_0.owner ? teammateColors[task_0.owner] : undefined} openBlockers={task_0.blockedBy.filter(id_3 => unresolvedTaskIds.has(id_3))} activity={task_0.owner ? teammateActivity[task_0.owner] : undefined} ownerActive={task_0.owner ? activeTeammates.has(task_0.owner) : false} columns={effectiveColumns} />)}
      {maxDisplay > 0 && hiddenSummary && <FullWidthRow><Text dimColor>{hiddenSummary}</Text></FullWidthRow>}
    </>;
  if (isStandalone) {
    return <Box flexDirection="column" marginTop={1} marginLeft={2} width="100%">
        <Box width="100%">
          <Text dimColor>
            <Text bold>{tasks.length}</Text>
            {' tasks ('}
            <Text bold>{completedCount}</Text>
            {' done, '}
            {inProgressCount > 0 && <>
                <Text bold>{inProgressCount}</Text>
                {' in progress, '}
              </>}
            <Text bold>{pendingCount}</Text>
            {' open)'}
          </Text>
        </Box>
        {content}
      </Box>;
  }
  return <Box flexDirection="column" width="100%">{content}</Box>;
}
type TaskItemProps = {
  task: Task;
  ownerColor?: keyof Theme;
  openBlockers: string[];
  activity?: string;
  ownerActive: boolean;
  columns: number;
};
const TASK_SPINNER_FRAMES = ['⠂', '⠒', '⠐', '⠰', '⠠', '⠤', '⠄', '⠆'];
const TASK_SPINNER_MS = 80;

function TaskStatusIcon({ status }: { status: Task['status'] }): React.ReactNode {
  const [ref, time] = useAnimationFrame(status === 'in_progress' ? TASK_SPINNER_MS : null);
  if (status === 'completed') {
    return <Box ref={ref}><Text dimColor>⠶ </Text></Box>;
  }
  if (status === 'in_progress') {
    const frame = TASK_SPINNER_FRAMES[Math.floor(time / TASK_SPINNER_MS) % TASK_SPINNER_FRAMES.length];
    return <Box ref={ref}><Text dimColor>{frame} </Text></Box>;
  }
  return <Box ref={ref}><Text dimColor={true}>⠂ </Text></Box>;
}
function TaskItem({
  task,
  ownerColor,
  openBlockers,
  activity,
  ownerActive,
  columns
}: TaskItemProps): React.ReactNode {
  const isCompleted = task.status === "completed";
  const isInProgress = task.status === "in_progress";
  const isBlocked = openBlockers.length > 0;
  const showActivity = isInProgress && !isBlocked && activity;
  const showOwner = columns >= 60 && task.owner && ownerActive;
  const taskIdText = `#${task.id}`;
  const ownerWidth = showOwner ? stringWidth(` (@${task.owner})`) : 0;
  const maxSubjectWidth = Math.max(15, columns - 15 - ownerWidth);
  const displaySubject = truncateToWidth(task.subject, maxSubjectWidth);
  const maxActivityWidth = Math.max(15, columns - 15);
  const displayActivity = activity ? truncateToWidth(activity, maxActivityWidth) : undefined;
  const statusIcon = <TaskStatusIcon status={task.status} />;
  const dimSubject = isCompleted || isBlocked;
  const subjectText = <Text bold={isInProgress} strikethrough={isCompleted} dimColor={dimSubject}>{displaySubject}</Text>;
  const ownerText = showOwner && <Text dimColor={true}>{" ("}{ownerColor ? <ThemedText color={ownerColor}>@{task.owner}</ThemedText> : `@${task.owner}`}{")"}</Text>;
  const blockedText = isBlocked && <Text dimColor={true}>{" "}{figures.pointerSmall} blocked by{" "}{[...openBlockers].sort(_temp).map(_temp2).join(", ")}</Text>;
  const row = <FullWidthRow trailing={<Text dimColor={true}>{taskIdText}</Text>}>{statusIcon}{subjectText}{ownerText}{blockedText}</FullWidthRow>;
  const activityRow = showActivity && displayActivity && <FullWidthRow><Text dimColor={true}>{"  "}{displayActivity}{figures.ellipsis}</Text></FullWidthRow>;
  return <Box flexDirection="column" width="100%">{row}{activityRow}</Box>;
}
function _temp2(id) {
  return `#${id}`;
}
function _temp(a, b) {
  return parseInt(a, 10) - parseInt(b, 10);
}
