import * as React from 'react';
import { Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
type Props = {
  teamsSelected: boolean;
  showHint: boolean;
};

/**
 * Footer status indicator showing teammate count
 * Similar to BackgroundTaskStatus but for teammates
 */
export function TeamStatus({ teamsSelected, showHint }: Props) {
  const teamContext = useAppState(_temp);
  const totalTeammates = teamContext ? Object.values(teamContext.teammates).filter(_temp2).length : 0;
  if (totalTeammates === 0) {
    return null;
  }
  const hint = showHint && teamsSelected ? <><Text dimColor={true}>· </Text><Text dimColor={true}>Enter to view</Text></> : null;
  const statusText = `${totalTeammates} ${totalTeammates === 1 ? "teammate" : "teammates"}`;
  return <><Text key={teamsSelected ? "selected" : "normal"} color="background" inverse={teamsSelected}>{statusText}</Text>{hint ? <Text> {hint}</Text> : null}</>;
}
function _temp2(t) {
  return t.name !== "team-lead";
}
function _temp(s) {
  return s.teamContext;
}
