import chalk from 'chalk';
import type { UUID } from 'crypto';
import * as React from 'react';
import { getSessionId } from '../../bootstrap/state.js';
import type { CommandResultDisplay } from '../../commands.js';
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js';
import { Box, Text } from '../../ink.js';
import { logEvent } from '../../services/analytics/index.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { recursivelySanitizeUnicode } from '../../utils/sanitization.js';
import { getCurrentSessionTag, getTranscriptPath, saveTag } from '../../utils/sessionStorage.js';

function ConfirmRemoveTag({
  tagName,
  onConfirm,
  onCancel,
}: {
  tagName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const subtitle = `Current tag: #${tagName}`;
  return (
    <Dialog title="Remove tag?" subtitle={subtitle} onCancel={onCancel} color="warning">
      <Box flexDirection="column" gap={1}>
        <Text>This will remove the tag from the current session.</Text>
        <Select
          onChange={value => (value === "yes" ? onConfirm() : onCancel())}
          options={[
            {
              label: "Yes, remove tag",
              value: "yes",
            },
            {
              label: "No, keep tag",
              value: "no",
            },
          ]}
        />
      </Box>
    </Dialog>
  );
}

function ToggleTagAndClose({
  tagName,
  onDone,
}: {
  tagName: string
  onDone: LocalJSXCommandOnDone
}) {
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [sessionId, setSessionId] = React.useState<UUID | null>(null);
  const normalizedTag = recursivelySanitizeUnicode(tagName).trim();

  React.useEffect(() => {
    const id = getSessionId() as UUID;
    if (!id) {
      onDone("No active session to tag", {
        display: "system"
      });
      return;
    }
    if (!normalizedTag) {
      onDone("Tag name cannot be empty", {
        display: "system"
      });
      return;
    }
    setSessionId(id);
    const currentTag = getCurrentSessionTag(id);
    if (currentTag === normalizedTag) {
      logEvent("tengu_tag_command_remove_prompt", {});
      setShowConfirm(true);
    } else {
      const isReplacing = !!currentTag;
      logEvent("tengu_tag_command_add", {
        is_replacing: isReplacing
      });
      (async () => {
        const fullPath = getTranscriptPath();
        await saveTag(id, normalizedTag, fullPath);
        onDone(`Tagged session with ${chalk.cyan(`#${normalizedTag}`)}`, {
          display: "system"
        });
      })();
    }
  }, [normalizedTag, onDone]);

  if (showConfirm && sessionId) {
    return (
      <ConfirmRemoveTag
        tagName={normalizedTag}
        onConfirm={async () => {
          logEvent("tengu_tag_command_remove_confirmed", {});
          const fullPath = getTranscriptPath();
          await saveTag(sessionId, "", fullPath);
          onDone(`Removed tag ${chalk.cyan(`#${normalizedTag}`)}`, {
            display: "system"
          });
        }}
        onCancel={() => {
          logEvent("tengu_tag_command_remove_cancelled", {});
          onDone(`Kept tag ${chalk.cyan(`#${normalizedTag}`)}`, {
            display: "system"
          });
        }}
      />
    );
  }
  return null;
}

function ShowHelp({ onDone }: { onDone: LocalJSXCommandOnDone }) {
  React.useEffect(() => {
    onDone("Usage: /tag <tag-name>\n\nToggle a searchable tag on the current session.\nRun the same command again to remove the tag.\nTags are displayed after the branch name in /resume and can be searched with /.\n\nExamples:\n  /tag bugfix        # Add tag\n  /tag bugfix        # Remove tag (toggle)\n  /tag feature-auth\n  /tag wip", {
      display: "system"
    });
  }, [onDone]);
  return null;
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  args = args?.trim() || '';
  if (COMMON_INFO_ARGS.includes(args) || COMMON_HELP_ARGS.includes(args)) {
    return <ShowHelp onDone={onDone} />;
  }
  if (!args) {
    return <ShowHelp onDone={onDone} />;
  }
  return <ToggleTagAndClose tagName={args} onDone={onDone} />;
}
