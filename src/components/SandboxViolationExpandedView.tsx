import * as React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text } from '../ink.js';
import type { SandboxViolationEvent } from '../utils/sandbox/sandbox-adapter.js';
import { SandboxManager } from '../utils/sandbox/sandbox-adapter.js';

/**
 * Format a timestamp as "h:mm:ssa" (e.g., "1:30:45pm").
 * Replaces date-fns format() to avoid pulling in a 39MB dependency for one call.
 */
function formatTime(date: Date): string {
  const h = date.getHours() % 12 || 12;
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ampm = date.getHours() < 12 ? 'am' : 'pm';
  return `${h}:${m}:${s}${ampm}`;
}
import { getPlatform } from 'src/utils/platform.js';
export function SandboxViolationExpandedView() {
  const [violations, setViolations] = useState<SandboxViolationEvent[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (!SandboxManager.isSandboxingEnabled() || getPlatform() === "linux") {
      return;
    }
    const store = SandboxManager.getSandboxViolationStore();
    if (!store || typeof store.subscribe !== "function") {
      return;
    }
    const unsubscribe = store.subscribe(allViolations => {
      setViolations(allViolations.slice(-10));
      setTotalCount(store.getTotalCount());
    });
    return unsubscribe;
  }, []);

  if (!SandboxManager.isSandboxingEnabled() || getPlatform() === "linux") {
    return null;
  }
  if (totalCount === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginLeft={0}>
        <Text color="permission">⧈ Sandbox blocked {totalCount} total{" "}{totalCount === 1 ? "operation" : "operations"}</Text>
      </Box>
      {violations.map(_temp)}
      <Box paddingLeft={2}>
        <Text dimColor={true}>… showing last {Math.min(10, violations.length)} of {totalCount}</Text>
      </Box>
    </Box>
  );
}
function _temp(v: SandboxViolationEvent, i: number) {
  return <Box key={`${v.timestamp.getTime()}-${i}`} paddingLeft={2}><Text dimColor={true}>{formatTime(v.timestamp)}{v.command ? ` ${v.command}:` : ""} {v.line}</Text></Box>;
}
