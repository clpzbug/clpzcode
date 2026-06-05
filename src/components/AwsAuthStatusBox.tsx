import React, { useEffect, useState } from 'react';
import { Box, Link, Text } from '../ink.js';
import { type AwsAuthStatus, AwsAuthStatusManager } from '../utils/awsAuthStatusManager.js';
const URL_RE = /https?:\/\/\S+/;
export function AwsAuthStatusBox() {
  const [status, setStatus] = useState(AwsAuthStatusManager.getInstance().getStatus());
  useEffect(() => {
    const unsubscribe = AwsAuthStatusManager.getInstance().subscribe(setStatus);
    return unsubscribe;
  }, []);
  if (!status.isAuthenticating && !status.error && status.output.length === 0) {
    return null;
  }
  if (!status.isAuthenticating && !status.error) {
    return null;
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1} marginY={1}>
      <Text bold={true} color="permission">Cloud Authentication</Text>
      {status.output.length > 0 && <Box flexDirection="column" marginTop={1}>{status.output.slice(-5).map(_temp)}</Box>}
      {status.error && <Box marginTop={1}><Text color="error">{status.error}</Text></Box>}
    </Box>
  );
}
function _temp(line, index) {
  const m = line.match(URL_RE);
  if (!m) {
    return <Text key={index} dimColor={true}>{line}</Text>;
  }
  const url = m[0];
  const start = m.index ?? 0;
  const before = line.slice(0, start);
  const after = line.slice(start + url.length);
  return <Text key={index} dimColor={true}>{before}<Link url={url}>{url}</Link>{after}</Text>;
}
