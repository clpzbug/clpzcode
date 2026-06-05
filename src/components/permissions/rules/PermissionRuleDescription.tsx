import * as React from 'react';
import { Text } from '../../../ink.js';
import { BashTool } from '../../../tools/BashTool/BashTool.js';
import type { PermissionRuleValue } from '../../../utils/permissions/PermissionRule.js';
type RuleSubtitleProps = {
  ruleValue: PermissionRuleValue;
};
export function PermissionRuleDescription({ ruleValue }: RuleSubtitleProps) {
  switch (ruleValue.toolName) {
    case BashTool.name:
      {
        if (ruleValue.ruleContent) {
          if (ruleValue.ruleContent.endsWith(":*")) {
            const prefix = ruleValue.ruleContent.slice(0, -2);
            return <Text dimColor={true}>Any Bash command starting with{" "}<Text bold={true}>{prefix}</Text></Text>;
          } else {
            return <Text dimColor={true}>The Bash command <Text bold={true}>{ruleValue.ruleContent}</Text></Text>;
          }
        } else {
          return <Text dimColor={true}>Any Bash command</Text>;
        }
      }
    default:
      {
        if (!ruleValue.ruleContent) {
          return <Text dimColor={true}>Any use of the <Text bold={true}>{ruleValue.toolName}</Text> tool</Text>;
        } else {
          return null;
        }
      }
  }
}
