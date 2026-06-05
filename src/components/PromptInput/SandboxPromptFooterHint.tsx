import * as React from 'react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Box, Text } from '../../ink.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
export function SandboxPromptFooterHint() {
  const [recentViolationCount, setRecentViolationCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailsShortcut = useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o");
  useEffect(() => {
    if (!SandboxManager.isSandboxingEnabled()) {
      return;
    }
    const store = SandboxManager.getSandboxViolationStore();
    let lastCount = store.getTotalCount();
    const unsubscribe = store.subscribe(() => {
      const currentCount = store.getTotalCount();
      const newViolations = currentCount - lastCount;
      if (newViolations > 0) {
        setRecentViolationCount(newViolations);
        lastCount = currentCount;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(setRecentViolationCount, 5000, 0);
      }
    });
    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
  if (!SandboxManager.isSandboxingEnabled() || recentViolationCount === 0) {
    return null;
  }
  const operationLabel = recentViolationCount === 1 ? "operation" : "operations";
  return <Box paddingX={0} paddingY={0}><Text color="inactive" wrap="truncate">⧈ Sandbox blocked {recentViolationCount}{" "}{operationLabel} ·{" "}{detailsShortcut} for details · /sandbox to disable</Text></Box>;
}
