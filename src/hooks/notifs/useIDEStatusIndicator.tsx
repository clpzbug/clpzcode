import React, { useEffect, useRef } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { Text } from 'src/ink.js';
import type { MCPServerConnection } from 'src/services/mcp/types.js';
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js';
import { detectIDEs, type IDEExtensionInstallationStatus, isJetBrainsIde, isSupportedTerminal } from 'src/utils/ide.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import { useIdeConnectionStatus } from '../useIdeConnectionStatus.js';
import type { IDESelection } from '../useIdeSelection.js';
const MAX_IDE_HINT_SHOW_COUNT = 5;
type Props = {
  ideInstallationStatus: IDEExtensionInstallationStatus | null;
  ideSelection: IDESelection | undefined;
  mcpClients: MCPServerConnection[];
};
export function useIDEStatusIndicator({
  ideSelection,
  mcpClients,
  ideInstallationStatus
}: Props) {
  const {
    addNotification,
    removeNotification
  } = useNotifications();
  const {
    status: ideStatus,
    ideName
  } = useIdeConnectionStatus(mcpClients);
  const hasShownHintRef = useRef(false);
  const isJetBrains = ideInstallationStatus ? isJetBrainsIde(ideInstallationStatus?.ideType) : false;
  const showIDEInstallErrorOrJetBrainsInfo = ideInstallationStatus?.error || isJetBrains;
  const shouldShowIdeSelection = ideStatus === "connected" && (ideSelection?.filePath || ideSelection?.text && ideSelection.lineCount > 0);
  const shouldShowConnected = ideStatus === "connected" && !shouldShowIdeSelection;
  const showIDEInstallError = showIDEInstallErrorOrJetBrainsInfo && !isJetBrains && !shouldShowConnected && !shouldShowIdeSelection;
  const showJetBrainsInfo = showIDEInstallErrorOrJetBrainsInfo && isJetBrains && !shouldShowConnected && !shouldShowIdeSelection;
  useEffect(() => {
    if (getIsRemoteMode()) {
      return;
    }
    if (isSupportedTerminal() || ideStatus !== null || showJetBrainsInfo) {
      removeNotification("ide-status-hint");
      return;
    }
    if (hasShownHintRef.current || (getGlobalConfig().ideHintShownCount ?? 0) >= MAX_IDE_HINT_SHOW_COUNT) {
      return;
    }
    const timeoutId = setTimeout(_temp2, 3000, hasShownHintRef, addNotification);
    return () => clearTimeout(timeoutId);
  }, [addNotification, removeNotification, ideStatus, showJetBrainsInfo]);
  useEffect(() => {
    if (getIsRemoteMode()) {
      return;
    }
    if (showIDEInstallError || showJetBrainsInfo || ideStatus !== "disconnected" || !ideName) {
      removeNotification("ide-status-disconnected");
      return;
    }
    addNotification({
      key: "ide-status-disconnected",
      text: `${ideName} disconnected`,
      color: "error",
      priority: "medium"
    });
  }, [addNotification, removeNotification, ideStatus, ideName, showIDEInstallError, showJetBrainsInfo]);
  useEffect(() => {
    if (getIsRemoteMode()) {
      return;
    }
    if (!showJetBrainsInfo) {
      removeNotification("ide-status-jetbrains-disconnected");
      return;
    }
    addNotification({
      key: "ide-status-jetbrains-disconnected",
      text: "IDE plugin not connected \xB7 /status for info",
      priority: "medium"
    });
  }, [addNotification, removeNotification, showJetBrainsInfo]);
  useEffect(() => {
    if (getIsRemoteMode()) {
      return;
    }
    if (!showIDEInstallError) {
      removeNotification("ide-status-install-error");
      return;
    }
    addNotification({
      key: "ide-status-install-error",
      text: "IDE extension install failed (see /status for info)",
      color: "error",
      priority: "medium"
    });
  }, [addNotification, removeNotification, showIDEInstallError]);
}
function _temp2(hasShownHintRef_0, addNotification_0) {
  detectIDEs(true).then(infos => {
    const ideName_0 = infos[0]?.name;
    if (ideName_0 && !hasShownHintRef_0.current) {
      hasShownHintRef_0.current = true;
      saveGlobalConfig(_temp);
      addNotification_0({
        key: "ide-status-hint",
        jsx: <Text dimColor={true}>/ide for <Text color="ide">{ideName_0}</Text></Text>,
        priority: "low"
      });
    }
  });
}
function _temp(current) {
  return {
    ...current,
    ideHintShownCount: (current.ideHintShownCount ?? 0) + 1
  };
}
