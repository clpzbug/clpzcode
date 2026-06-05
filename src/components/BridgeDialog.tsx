import { basename } from 'path';
import { toString as qrToString } from 'qrcode';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { getOriginalCwd } from '../bootstrap/state.js';
import { buildActiveFooterText, buildIdleFooterText, FAILED_FOOTER_TEXT, getBridgeStatus } from '../bridge/bridgeStatusUtil.js';
import { BRIDGE_FAILED_INDICATOR, BRIDGE_READY_INDICATOR } from '../constants/figures.js';
import { useRegisterOverlay } from '../context/overlayContext.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw 'd' key for disconnect, not a configurable keybinding action
import { Box, Text, useInput } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import { saveGlobalConfig } from '../utils/config.js';
import { getBranch } from '../utils/git.js';
import { Dialog } from './design-system/Dialog.js';

type Props = {
  onDone: () => void;
};

export function BridgeDialog({ onDone }: Props) {
  useRegisterOverlay("bridge-dialog");
  const connected = useAppState(s => s.replBridgeConnected);
  const sessionActive = useAppState(s => s.replBridgeSessionActive);
  const reconnecting = useAppState(s => s.replBridgeReconnecting);
  const connectUrl = useAppState(s => s.replBridgeConnectUrl);
  const sessionUrl = useAppState(s => s.replBridgeSessionUrl);
  const error = useAppState(s => s.replBridgeError);
  const explicit = useAppState(s => s.replBridgeExplicit);
  const environmentId = useAppState(s => s.replBridgeEnvironmentId);
  const sessionId = useAppState(s => s.replBridgeSessionId);
  const verbose = useAppState(s => s.verbose);
  const setAppState = useSetAppState();
  const [showQR, setShowQR] = useState(false);
  const [qrText, setQrText] = useState("");
  const [branchName, setBranchName] = useState("");

  const repoName = basename(getOriginalCwd());

  useEffect(() => {
    getBranch().then(setBranchName).catch(() => {});
  }, []);

  const displayUrl = sessionActive ? sessionUrl : connectUrl;

  useEffect(() => {
    if (!showQR || !displayUrl) {
      setQrText("");
      return;
    }
    qrToString(displayUrl, {
      type: "utf8",
      errorCorrectionLevel: "L",
      small: true
    }).then(setQrText).catch(() => setQrText(""));
  }, [showQR, displayUrl]);

  useKeybindings({
    "confirm:yes": onDone,
    "confirm:toggle": () => {
      setShowQR(prev => !prev);
    }
  }, {
    context: "Confirmation"
  });

  useInput(input => {
    if (input === "d") {
      if (explicit) {
        saveGlobalConfig(current => {
          if (current.remoteControlAtStartup === false) {
            return current;
          }
          return {
            ...current,
            remoteControlAtStartup: false
          };
        });
      }
      setAppState(prev => {
        if (!prev.replBridgeEnabled) {
          return prev;
        }
        return {
          ...prev,
          replBridgeEnabled: false
        };
      });
      onDone();
    }
  });

  const { label: statusLabel, color: statusColor } = getBridgeStatus({
    error,
    connected,
    sessionActive,
    reconnecting
  });
  const indicator = error ? BRIDGE_FAILED_INDICATOR : BRIDGE_READY_INDICATOR;

  const qrLines = qrText ? qrText.split("\n").filter(l => l.length > 0) : [];

  const contextParts: string[] = [];
  if (repoName) {
    contextParts.push(repoName);
  }
  if (branchName) {
    contextParts.push(branchName);
  }
  const contextSuffix = contextParts.length > 0 ? " \xB7 " + contextParts.join(" \xB7 ") : "";

  const footerText = error ? FAILED_FOOTER_TEXT : displayUrl ? sessionActive ? buildActiveFooterText(displayUrl) : buildIdleFooterText(displayUrl) : undefined;

  return (
    <Dialog title="Remote Control" onCancel={onDone} hideInputGuide={true}>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>
            <Text color={statusColor}>{indicator} {statusLabel}</Text>
            <Text dimColor={true}>{contextSuffix}</Text>
          </Text>
          {error && <Text color="error">{error}</Text>}
          {verbose && environmentId && <Text dimColor={true}>Environment: {environmentId}</Text>}
          {verbose && sessionId && <Text dimColor={true}>Session: {sessionId}</Text>}
        </Box>
        {showQR && qrLines.length > 0 && <Box flexDirection="column">{qrLines.map((line, i) => <Text key={i}>{line}</Text>)}</Box>}
        {footerText && <Text dimColor={true}>{footerText}</Text>}
        <Text dimColor={true}>d to disconnect · space for QR code · Enter/Esc to close</Text>
      </Box>
    </Dialog>
  );
}
