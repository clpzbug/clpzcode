import * as React from 'react';
import { Box, Text } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
import type { WorkerBadgeProps } from './WorkerBadge.js';
type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  workerBadge?: WorkerBadgeProps;
};
export function PermissionRequestTitle({ title, subtitle, color = "permission", workerBadge }: Props) {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold={true} color={color}>{title}</Text>
        {workerBadge && <Text dimColor={true}>{"\xB7 "}@{workerBadge.name}</Text>}
      </Box>
      {subtitle != null && (typeof subtitle === "string" ? <Text dimColor={true} wrap="truncate-start">{subtitle}</Text> : subtitle)}
    </Box>
  );
}
