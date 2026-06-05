import * as React from 'react';
import { useInterval } from 'usehooks-ts';
import { getIsRemoteMode, getIsScrollDraining } from '../../bootstrap/state.js';
import { useNotifications } from '../../context/notifications.js';
import { Text } from '../../ink.js';
import { getInitializationStatus, getLspServerManager } from '../../services/lsp/manager.js';
import { useSetAppState } from '../../state/AppState.js';
import type { PluginError } from '../../types/plugin.js';
import { logForDebugging } from '../../utils/debug.js';
const LSP_POLL_INTERVAL_MS = 5000;

/**
 * Hook that polls LSP status and shows a notification when:
 * 1. Manager initialization fails
 * 2. Any LSP server enters an error state
 *
 * Also adds errors to appState.plugins.errors for /doctor display.
 *
 * Active in normal REPL sessions. The manager itself no-ops in --bare mode.
 */
export function useLspInitializationNotification() {
  const {
    addNotification
  } = useNotifications();
  const setAppState = useSetAppState();
  const [shouldPoll, setShouldPoll] = React.useState(true);
  const notifiedErrorsRef = React.useRef(new Set<string>());
  const addError = (source: string, errorMessage: string) => {
    const errorKey = `${source}:${errorMessage}`;
    if (notifiedErrorsRef.current.has(errorKey)) {
      return;
    }
    notifiedErrorsRef.current.add(errorKey);
    logForDebugging(`LSP error: ${source} - ${errorMessage}`);
    setAppState(prev => {
      const existingKeys = new Set(prev.plugins.errors.map(getErrorKey));
      const stateErrorKey = `generic-error:${source}:${errorMessage}`;
      if (existingKeys.has(stateErrorKey)) {
        return prev;
      }
      return {
        ...prev,
        plugins: {
          ...prev.plugins,
          errors: [...prev.plugins.errors, {
            type: "generic-error" as const,
            source,
            error: errorMessage
          }]
        }
      };
    });
    const displayName = source.startsWith("plugin:") ? source.split(":")[1] ?? source : source;
    addNotification({
      key: `lsp-error-${source}`,
      jsx: <><Text color="error">LSP for {displayName} failed</Text><Text dimColor={true}> · /plugin for details</Text></>,
      priority: "medium",
      timeoutMs: 8000
    });
  };
  const poll = () => {
    if (getIsRemoteMode()) {
      return;
    }
    if (getIsScrollDraining()) {
      return;
    }
    const status = getInitializationStatus();
    if (status.status === "failed") {
      addError("lsp-manager", status.error.message);
      setShouldPoll(false);
      return;
    }
    if (status.status === "pending" || status.status === "not-started") {
      return;
    }
    const manager = getLspServerManager();
    if (manager) {
      const servers = manager.getAllServers();
      for (const [serverName, server] of servers) {
        if (server.state === "error" && server.lastError) {
          addError(serverName, server.lastError.message);
        }
      }
    }
  };
  useInterval(poll, shouldPoll ? LSP_POLL_INTERVAL_MS : null);
  React.useEffect(() => {
    if (getIsRemoteMode() || !shouldPoll) {
      return;
    }
    poll();
  }, [poll, shouldPoll]);
}
function getErrorKey(e: PluginError) {
  if (e.type === "generic-error") {
    return `generic-error:${e.source}:${e.error}`;
  }
  return `${e.type}:${e.source}`;
}
