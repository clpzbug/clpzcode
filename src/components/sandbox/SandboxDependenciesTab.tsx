import React from 'react';
import { Box, Text } from '../../ink.js';
import { getPlatform } from '../../utils/platform.js';
import type { SandboxDependencyCheck } from '../../utils/sandbox/sandbox-adapter.js';
type Props = {
  depCheck: SandboxDependencyCheck;
};
export function SandboxDependenciesTab({ depCheck }: Props) {
  const platform = getPlatform();
  const isMac = platform === "macos";
  const rgMissing = depCheck.errors.some(_temp);
  const bwrapMissing = depCheck.errors.some(_temp2);
  const socatMissing = depCheck.errors.some(_temp3);
  const seccompMissing = depCheck.warnings.length > 0;

  const otherErrors = depCheck.errors.filter(_temp4);
  const rgInstallHint = isMac ? "brew install ripgrep" : "apt install ripgrep";
  return <Box flexDirection="column" paddingY={1} gap={1}>{isMac && <Box flexDirection="column"><Text>seatbelt: <Text color="success">built-in (macOS)</Text></Text></Box>}<Box flexDirection="column"><Text>ripgrep (rg):{" "}{rgMissing ? <Text color="error">not found</Text> : <Text color="success">found</Text>}</Text>{rgMissing && <Text dimColor={true}>{"  "}· {rgInstallHint}</Text>}</Box>{!isMac && <><Box flexDirection="column"><Text>bubblewrap (bwrap):{" "}{bwrapMissing ? <Text color="error">not installed</Text> : <Text color="success">installed</Text>}</Text>{bwrapMissing && <Text dimColor={true}>{"  "}· apt install bubblewrap</Text>}</Box><Box flexDirection="column"><Text>socat:{" "}{socatMissing ? <Text color="error">not installed</Text> : <Text color="success">installed</Text>}</Text>{socatMissing && <Text dimColor={true}>{"  "}· apt install socat</Text>}</Box><Box flexDirection="column"><Text>seccomp filter:{" "}{seccompMissing ? <Text color="warning">not installed</Text> : <Text color="success">installed</Text>}{seccompMissing && <Text dimColor={true}> (required to block unix domain sockets)</Text>}</Text>{seccompMissing && <Box flexDirection="column"><Text dimColor={true}>{"  "}· npm install -g @anthropic-ai/sandbox-runtime</Text><Text dimColor={true}>{"  "}· or copy vendor/seccomp/* from sandbox-runtime and set</Text><Text dimColor={true}>{"    "}sandbox.seccomp.bpfPath and applyPath in settings.json</Text></Box>}</Box></>}{otherErrors.map(_temp5)}</Box>;
}
function _temp5(err: string) {
  return <Text key={err} color="error">{err}</Text>;
}
function _temp4(e_2: string) {
  return !e_2.includes("ripgrep") && !e_2.includes("bwrap") && !e_2.includes("socat");
}
function _temp3(e_1: string) {
  return e_1.includes("socat");
}
function _temp2(e_0: string) {
  return e_0.includes("bwrap");
}
function _temp(e: string) {
  return e.includes("ripgrep");
}
