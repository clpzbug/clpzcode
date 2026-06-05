import React from 'react';
import { Box, Text } from '../../ink.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
export function SandboxDoctorSection() {
  if (!SandboxManager.isSupportedPlatform()) {
    return null;
  }
  if (!SandboxManager.isSandboxEnabledInSettings()) {
    return null;
  }
  const depCheck = SandboxManager.checkDependencies();
  const hasErrors = depCheck.errors.length > 0;
  const hasWarnings = depCheck.warnings.length > 0;
  if (!hasErrors && !hasWarnings) {
    return null;
  }
  const statusColor = hasErrors ? "error" as const : "warning" as const;
  const statusText = hasErrors ? "Missing dependencies" : "Available (with warnings)";
  return <Box flexDirection="column"><Text bold={true}>Sandbox</Text><Text>└ Status: <Text color={statusColor}>{statusText}</Text></Text>{depCheck.errors.map(_temp)}{depCheck.warnings.map(_temp2)}{hasErrors && <Text dimColor={true}>└ Run /sandbox for install instructions</Text>}</Box>;
}
function _temp2(w: string, i_0: number) {
  return <Text key={i_0} color="warning">└ {w}</Text>;
}
function _temp(e: string, i: number) {
  return <Text key={i} color="error">└ {e}</Text>;
}
