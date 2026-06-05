import * as React from 'react';
import { Text } from 'src/ink.js';
import type { BackgroundTaskState } from 'src/tasks/types.js';
import type { DeepImmutable } from 'src/types/utils.js';
import { truncate } from 'src/utils/format.js';
import { toInkColor } from 'src/utils/ink.js';
import { plural } from 'src/utils/stringUtils.js';
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../../constants/figures.js';
import { RemoteSessionProgress } from './RemoteSessionProgress.js';
import { ShellProgress, TaskStatusText } from './ShellProgress.js';
import { describeTeammateActivity } from './taskStatusUtils.js';
type Props = {
  task: DeepImmutable<BackgroundTaskState>;
  maxActivityWidth?: number;
};
export function BackgroundTask({ task, maxActivityWidth }: Props) {
  const activityLimit = maxActivityWidth ?? 40;
  switch (task.type) {
    case "local_bash":
      {
        const label = task.kind === "monitor" ? task.description : task.command;
        const text = truncate(label, activityLimit, true);
        return <Text>{text}{" "}<ShellProgress shell={task} /></Text>;
      }
    case "remote_agent":
      {
        if (task.isRemoteReview) {
          return <Text><RemoteSessionProgress session={task} /></Text>;
        }
        const running = task.status === "running" || task.status === "pending";
        const figure = running ? DIAMOND_OPEN : DIAMOND_FILLED;
        const title = truncate(task.title, activityLimit, true);
        return <Text><Text dimColor={true}>{figure} </Text>{title}<Text dimColor={true}> · </Text><RemoteSessionProgress session={task} /></Text>;
      }
    case "local_agent":
      {
        const description = truncate(task.description, activityLimit, true);
        const label = task.status === "completed" ? "done" : undefined;
        const suffix = task.status === "completed" && !task.notified ? ", unread" : undefined;
        return <Text>{description}{" "}<TaskStatusText status={task.status} label={label} suffix={suffix} /></Text>;
      }
    case "in_process_teammate":
      {
        const activity = describeTeammateActivity(task);
        const color = toInkColor(task.identity.color);
        return <Text><Text color={color}>@{task.identity.agentName}</Text><Text dimColor={true}>{": "}{truncate(activity, activityLimit, true)}</Text></Text>;
      }
    case "local_workflow":
      {
        const workflowName = (task as { workflowName?: string }).workflowName;
        const agentCount = (task as { agentCount?: number }).agentCount as number;
        const name = workflowName ?? task.summary ?? task.description;
        const text = truncate(name, activityLimit, true);
        const label = task.status === "running" ? `${agentCount} ${plural(agentCount, "agent")}` : task.status === "completed" ? "done" : undefined;
        const suffix = task.status === "completed" && !task.notified ? ", unread" : undefined;
        return <Text>{text}{" "}<TaskStatusText status={task.status} label={label} suffix={suffix} /></Text>;
      }
    case "monitor_mcp":
      {
        const description = truncate(task.description, activityLimit, true);
        const label = task.status === "completed" ? "done" : undefined;
        const suffix = task.status === "completed" && !task.notified ? ", unread" : undefined;
        return <Text>{description}{" "}<TaskStatusText status={task.status} label={label} suffix={suffix} /></Text>;
      }
    case "dream":
      {
        const n = task.filesTouched.length;
        const detail = task.phase === "updating" && n > 0 ? `${n} ${plural(n, "file")}` : `${task.sessionsReviewing} ${plural(task.sessionsReviewing, "session")}`;
        const label = task.status === "completed" ? "done" : undefined;
        const suffix = task.status === "completed" && !task.notified ? ", unread" : undefined;
        return <Text>{task.description}{" "}<Text dimColor={true}>· {task.phase} · {detail}</Text>{" "}<TaskStatusText status={task.status} label={label} suffix={suffix} /></Text>;
      }
  }
}
