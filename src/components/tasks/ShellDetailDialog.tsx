import React, { Suspense, use, useDeferredValue, useEffect, useState } from 'react';
import type { DeepImmutable } from 'src/types/utils.js';
import type { CommandResultDisplay } from '../../commands.js';
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { LocalShellTaskState } from '../../tasks/LocalShellTask/guards.js';
import { formatDuration, formatFileSize, truncateToWidth } from '../../utils/format.js';
import { tailFile } from '../../utils/fsOperations.js';
import { getTaskOutputPath } from '../../utils/task/diskOutput.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
type Props = {
  shell: DeepImmutable<LocalShellTaskState>;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  onKillShell?: () => void;
  onBack?: () => void;
};
const SHELL_DETAIL_TAIL_BYTES = 8192;
type TaskOutputResult = {
  content: string;
  bytesTotal: number;
};

/**
 * Read the tail of the task output file. Only reads the last few KB,
 * not the entire file.
 */
async function getTaskOutput(shell: DeepImmutable<LocalShellTaskState>): Promise<TaskOutputResult> {
  const path = getTaskOutputPath(shell.id);
  try {
    const result = await tailFile(path, SHELL_DETAIL_TAIL_BYTES);
    return {
      content: result.content,
      bytesTotal: result.bytesTotal
    };
  } catch {
    return {
      content: '',
      bytesTotal: 0
    };
  }
}
export function ShellDetailDialog({
  shell,
  onDone,
  onKillShell,
  onBack
}: Props) {
  const {
    columns
  } = useTerminalSize();
  const [outputPromise, setOutputPromise] = useState(() => getTaskOutput(shell));
  const deferredOutputPromise = useDeferredValue(outputPromise);
  useEffect(() => {
    if (shell.status !== "running") {
      return;
    }
    const timer = setInterval(_temp, 1000, setOutputPromise, shell);
    return () => clearInterval(timer);
  }, [shell.id, shell.status]);
  const handleClose = () => onDone("Shell details dismissed", {
    display: "system"
  });
  useKeybindings({
    "confirm:yes": handleClose
  }, {
    context: "Confirmation"
  });
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === " ") {
      e.preventDefault();
      onDone("Shell details dismissed", {
        display: "system"
      });
    } else {
      if (e.key === "left" && onBack) {
        e.preventDefault();
        onBack();
      } else {
        if (e.key === "x" && shell.status === "running" && onKillShell) {
          e.preventDefault();
          onKillShell();
        }
      }
    }
  };
  const isMonitor = shell.kind === "monitor";
  const displayCommand = truncateToWidth(shell.command, 280);
  const title = isMonitor ? "Monitor details" : "Shell details";
  const inputGuide = (exitState: ExitState) => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>{onBack && <KeyboardShortcutHint shortcut={"←"} action="go back" />}<KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />{shell.status === "running" && onKillShell && <KeyboardShortcutHint shortcut="x" action="stop" />}</Byline>;
  const runtime = (shell.endTime ?? Date.now()) - shell.startTime;
  return <Box flexDirection="column" tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}><Dialog title={title} onCancel={handleClose} color="background" inputGuide={inputGuide}><Box flexDirection="column"><Text><Text bold={true}>Status:</Text>{" "}{shell.status === "running" ? <Text color="background">{shell.status}{shell.result?.code !== undefined && ` (exit code: ${shell.result.code})`}</Text> : shell.status === "completed" ? <Text color="success">{shell.status}{shell.result?.code !== undefined && ` (exit code: ${shell.result.code})`}</Text> : <Text color="error">{shell.status}{shell.result?.code !== undefined && ` (exit code: ${shell.result.code})`}</Text>}</Text><Text><Text bold={true}>Runtime:</Text>{" "}{formatDuration(runtime)}</Text><Text wrap="wrap"><Text bold={true}>{isMonitor ? "Script:" : "Command:"}</Text>{" "}{displayCommand}</Text></Box><Box flexDirection="column"><Text bold={true}>Output:</Text><Suspense fallback={<Text dimColor={true}>Loading output…</Text>}><ShellOutputContent outputPromise={deferredOutputPromise} columns={columns} /></Suspense></Box></Dialog></Box>;
}
function _temp(setOutputPromise_0: React.Dispatch<React.SetStateAction<Promise<TaskOutputResult>>>, shell_0: DeepImmutable<LocalShellTaskState>) {
  return setOutputPromise_0(getTaskOutput(shell_0));
}
type ShellOutputContentProps = {
  outputPromise: Promise<TaskOutputResult>;
  columns: number;
};
function ShellOutputContent({
  outputPromise,
  columns
}: ShellOutputContentProps) {
  const {
    content,
    bytesTotal
  } = use(outputPromise) as any;
  if (!content) {
    return <Text dimColor={true}>No output available</Text>;
  }
  const starts: number[] = [];
  let pos = content.length;
  for (let i = 0; i < 10 && pos > 0; i++) {
    const prev = content.lastIndexOf("\n", pos - 1);
    starts.push(prev + 1);
    pos = prev;
  }
  starts.reverse();
  const isIncomplete = bytesTotal > content.length;
  const rendered: string[] = [];
  for (let i_0 = 0; i_0 < starts.length; i_0++) {
    const start = starts[i_0];
    const end = i_0 < starts.length - 1 ? starts[i_0 + 1] - 1 : content.length;
    const line = content.slice(start, end);
    if (line) {
      rendered.push(line);
    }
  }
  const maxWidth = columns - 6;
  return <>
    <Box borderStyle="round" paddingX={1} flexDirection="column" height={12} maxWidth={maxWidth}>{rendered.map(_temp2)}</Box>
    <Text dimColor={true} italic={true}>{`Showing ${rendered.length} lines`}{isIncomplete ? ` of ${formatFileSize(bytesTotal)}` : ""}</Text>
  </>;
}
function _temp2(line_0: string, i_1: number) {
  return <Text key={i_1} wrap="truncate-end">{line_0}</Text>;
}
