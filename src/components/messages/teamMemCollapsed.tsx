import React from 'react';
import { Text } from '../../ink.js';
import type { CollapsedReadSearchGroup } from '../../types/message.js';

/**
 * Plain function (not a React component) so the React Compiler won't
 * hoist the teamMemory* property accesses for memoization. This module
 * is only loaded when feature('TEAMMEM') is true.
 */
export function checkHasTeamMemOps(message: CollapsedReadSearchGroup): boolean {
  return (message.teamMemorySearchCount ?? 0) > 0 || (message.teamMemoryReadCount ?? 0) > 0 || (message.teamMemoryWriteCount ?? 0) > 0;
}

/**
 * Renders team memory count parts for the collapsed read/search UI.
 * This module is only loaded when feature('TEAMMEM') is true,
 * so DCE removes it entirely from external builds.
 */
type Props = { message: CollapsedReadSearchGroup; isActiveGroup: boolean; hasPrecedingParts: boolean }
export function TeamMemCountParts({ message, isActiveGroup, hasPrecedingParts }: Props) {
  const tmReadCount = message.teamMemoryReadCount ?? 0;
  const tmSearchCount = message.teamMemorySearchCount ?? 0;
  const tmWriteCount = message.teamMemoryWriteCount ?? 0;
  if (tmReadCount === 0 && tmSearchCount === 0 && tmWriteCount === 0) {
    return null;
  }
  const nodes: React.ReactElement[] = [];
  let count = hasPrecedingParts ? 1 : 0;
  if (tmReadCount > 0) {
    const verb = isActiveGroup ? count === 0 ? "Recalling" : "recalling" : count === 0 ? "Recalled" : "recalled";
    if (count > 0) {
      nodes.push(<Text key="comma-tmr">, </Text>);
    }
    const readCountText = <Text bold={true}>{tmReadCount}</Text>;
    const memoriesWord = tmReadCount === 1 ? "memory" : "memories";
    nodes.push(<Text key="team-mem-read">{verb} {readCountText} team{" "}{memoriesWord}</Text>);
    count++;
  }
  if (tmSearchCount > 0) {
    const verb_0 = isActiveGroup ? count === 0 ? "Searching" : "searching" : count === 0 ? "Searched" : "searched";
    if (count > 0) {
      nodes.push(<Text key="comma-tms">, </Text>);
    }
    nodes.push(<Text key="team-mem-search">{`${verb_0} team memories`}</Text>);
    count++;
  }
  if (tmWriteCount > 0) {
    const verb_1 = isActiveGroup ? count === 0 ? "Writing" : "writing" : count === 0 ? "Wrote" : "wrote";
    if (count > 0) {
      nodes.push(<Text key="comma-tmw">, </Text>);
    }
    const writeCountText = <Text bold={true}>{tmWriteCount}</Text>;
    const memoriesWord = tmWriteCount === 1 ? "memory" : "memories";
    nodes.push(<Text key="team-mem-write">{verb_1} {writeCountText} team{" "}{memoriesWord}</Text>);
  }
  return <>{nodes}</>;
}
