import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { Box, Link, Text } from '../ink.js';
import type { ExternalClaudeMdInclude } from '../utils/claudemd.js';
import { saveCurrentProjectConfig } from '../utils/config.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type Props = {
  onDone(): void;
  isStandaloneDialog?: boolean;
  externalIncludes?: ExternalClaudeMdInclude[];
};
export function ClaudeMdExternalIncludesDialog({
  onDone,
  isStandaloneDialog,
  externalIncludes
}: Props) {
  React.useEffect(() => {
    logEvent("tengu_claude_md_includes_dialog_shown", {});
  }, []);
  const handleSelection = (value: 'yes' | 'no') => {
    if (value === "no") {
      logEvent("tengu_claude_md_external_includes_dialog_declined", {});
      saveCurrentProjectConfig(current => ({
        ...current,
        hasClaudeMdExternalIncludesApproved: false,
        hasClaudeMdExternalIncludesWarningShown: true
      }));
    } else {
      logEvent("tengu_claude_md_external_includes_dialog_accepted", {});
      saveCurrentProjectConfig(current => ({
        ...current,
        hasClaudeMdExternalIncludesApproved: true,
        hasClaudeMdExternalIncludesWarningShown: true
      }));
    }
    onDone();
  };
  const handleEscape = () => {
    handleSelection("no");
  };
  return (
    <Dialog
      title="Allow external CLAUDE.md file imports?"
      color="warning"
      onCancel={handleEscape}
      hideBorder={!isStandaloneDialog}
      hideInputGuide={!isStandaloneDialog}
    >
      <Text>This project's CLAUDE.md imports files outside the current working directory. Never allow this for third-party repositories.</Text>
      {externalIncludes && externalIncludes.length > 0 && <Box flexDirection="column"><Text dimColor={true}>External imports:</Text>{externalIncludes.map((include, i) => <Text key={i} dimColor={true}>{"  "}{include.path}</Text>)}</Box>}
      <Text dimColor={true}>Important: Only use Claude Code with files you trust. Accessing untrusted files may pose security risks{" "}<Link url="https://code.claude.com/docs/en/security" />{" "}</Text>
      <Select options={[{
        label: "Yes, allow external imports",
        value: "yes"
      }, {
        label: "No, disable external imports",
        value: "no"
      }]} onChange={(value: string) => handleSelection(value as 'yes' | 'no')} />
    </Dialog>
  );
}
