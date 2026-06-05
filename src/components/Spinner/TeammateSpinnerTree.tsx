import figures from 'figures';
import * as React from 'react';
import { Box, Text, type TextProps } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { getRunningTeammatesSorted } from '../../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import { formatNumber } from '../../utils/format.js';
import { TeammateSpinnerLine } from './TeammateSpinnerLine.js';
import { TEAMMATE_SELECT_HINT } from './teammateSelectHint.js';
type Props = {
  selectedIndex?: number;
  isInSelectionMode?: boolean;
  allIdle?: boolean;
  /** Leader's active verb (when leader is actively processing) */
  leaderVerb?: string;
  /** Leader's token count (when leader is actively processing) */
  leaderTokenCount?: number;
  /** Leader's idle status text (when leader is idle, e.g. "✻ Idle for 3s") */
  leaderIdleText?: string;
};
export function TeammateSpinnerTree({
  selectedIndex,
  isInSelectionMode,
  allIdle,
  leaderVerb,
  leaderTokenCount,
  leaderIdleText
}: Props) {
  const tasks = useAppState(s => s.tasks);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const showTeammateMessagePreview = useAppState(s => s.showTeammateMessagePreview);

  const teammateTasks = getRunningTeammatesSorted(tasks);
  if (teammateTasks.length === 0) {
    return null;
  }

  const isLeaderForegrounded = viewingAgentTaskId === undefined;
  const isLeaderSelected = isInSelectionMode && selectedIndex === -1;
  const isLeaderHighlighted = isLeaderForegrounded || isLeaderSelected;
  const isHideSelected = isInSelectionMode === true && selectedIndex === teammateTasks.length;

  const pointerColor: TextProps['color'] = isLeaderSelected ? "suggestion" : undefined;
  const pointer = isLeaderSelected ? figures.pointer : " ";
  const branch = isLeaderHighlighted ? "╒═" : "┌─";
  const labelColor: TextProps['color'] = isLeaderSelected ? "suggestion" : "cyan_FOR_SUBAGENTS_ONLY";

  const leaderRow = (
    <Box paddingLeft={3}>
      <Text color={pointerColor} bold={isLeaderHighlighted}>{pointer}</Text>
      <Text dimColor={!isLeaderHighlighted} bold={isLeaderHighlighted}>{branch}{" "}</Text>
      <Text bold={isLeaderHighlighted} color={labelColor}>team-lead</Text>
      {!isLeaderForegrounded && leaderVerb && <Text dimColor={true}>: {leaderVerb}…</Text>}
      {!isLeaderForegrounded && !leaderVerb && leaderIdleText && <Text dimColor={true}>: {leaderIdleText}</Text>}
      {leaderTokenCount !== undefined && leaderTokenCount > 0 && <Text dimColor={!isLeaderHighlighted}>{" "}· {formatNumber(leaderTokenCount)} tokens</Text>}
      {isLeaderHighlighted && <Text dimColor={true}> · {TEAMMATE_SELECT_HINT}</Text>}
      {isLeaderSelected && !isLeaderForegrounded && <Text dimColor={true}> · enter to view</Text>}
    </Box>
  );

  const teammateRows = teammateTasks.map((teammate, index) => <TeammateSpinnerLine key={teammate.id} teammate={teammate} isLast={!isInSelectionMode && index === teammateTasks.length - 1} isSelected={isInSelectionMode && selectedIndex === index} isForegrounded={viewingAgentTaskId === teammate.id} allIdle={allIdle} showPreview={showTeammateMessagePreview} />);

  return (
    <Box flexDirection="column" marginTop={1}>
      {leaderRow}
      {teammateRows}
      {isInSelectionMode && <HideRow isSelected={isHideSelected} />}
    </Box>
  );
}
function HideRow({
  isSelected
}: {
  isSelected: boolean;
}) {
  const pointerColor: TextProps['color'] = isSelected ? "suggestion" : undefined;
  const pointer = isSelected ? figures.pointer : " ";
  const branch = isSelected ? "╘═" : "└─";
  return (
    <Box paddingLeft={3}>
      <Text color={pointerColor} bold={isSelected}>{pointer}</Text>
      <Text dimColor={!isSelected} bold={isSelected}>{branch}{" "}</Text>
      <Text dimColor={!isSelected} bold={isSelected}>hide</Text>
      {isSelected && <Text dimColor={true}> · enter to collapse</Text>}
    </Box>
  );
}
