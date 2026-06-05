import { feature } from 'bun:bundle';
import { toString as qrToString } from 'qrcode';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { getBridgeAccessToken } from '../../bridge/bridgeConfig.js';
import { checkBridgeMinVersion, getBridgeDisabledReason, isEnvLessBridgeEnabled } from '../../bridge/bridgeEnabled.js';
import { checkEnvLessBridgeMinVersion } from '../../bridge/envLessBridgeConfig.js';
import { BRIDGE_LOGIN_INSTRUCTION, REMOTE_CONTROL_DISCONNECTED_MSG } from '../../bridge/types.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { ListItem } from '../../components/design-system/ListItem.js';
import { shouldShowRemoteCallout } from '../../components/RemoteCallout.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { logForDebugging } from '../../utils/debug.js';
type Props = {
  onDone: LocalJSXCommandOnDone;
  name?: string;
};

/**
 * /remote-control command — manages the bidirectional bridge connection.
 *
 * When enabled, sets replBridgeEnabled in AppState, which triggers
 * useReplBridge in REPL.tsx to initialize the bridge connection.
 * The bridge registers an environment, creates a session with the current
 * conversation, polls for work, and connects an ingress WebSocket for
 * bidirectional messaging between the CLI and claude.ai.
 *
 * Running /remote-control when already connected shows a dialog with the session
 * URL and options to disconnect or continue.
 */
function BridgeToggle({ onDone, name }: Props) {
  const setAppState = useSetAppState();
  const replBridgeConnected = useAppState(s => s.replBridgeConnected);
  const replBridgeEnabled = useAppState(s => s.replBridgeEnabled);
  const replBridgeOutboundOnly = useAppState(s => s.replBridgeOutboundOnly);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  useEffect(() => {
    if ((replBridgeConnected || replBridgeEnabled) && !replBridgeOutboundOnly) {
      setShowDisconnectDialog(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const error = await checkBridgePrerequisites();
      if (cancelled) {
        return;
      }
      if (error) {
        logEvent("tengu_bridge_command", {
          action: "preflight_failed" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        onDone(error, {
          display: "system"
        });
        return;
      }
      if (shouldShowRemoteCallout()) {
        setAppState(prev => {
          if (prev.showRemoteCallout) {
            return prev;
          }
          return {
            ...prev,
            showRemoteCallout: true,
            replBridgeInitialName: name
          };
        });
        onDone("", {
          display: "system"
        });
        return;
      }
      logEvent("tengu_bridge_command", {
        action: "connect" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      setAppState(prev_0 => {
        if (prev_0.replBridgeEnabled && !prev_0.replBridgeOutboundOnly) {
          return prev_0;
        }
        return {
          ...prev_0,
          replBridgeEnabled: true,
          replBridgeExplicit: true,
          replBridgeOutboundOnly: false,
          replBridgeInitialName: name
        };
      });
      onDone("Remote Control connecting…", {
        display: "system"
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (showDisconnectDialog) {
    return <BridgeDisconnectDialog onDone={onDone} />;
  }
  return null;
}

/**
 * Dialog shown when /remote-control is used while the bridge is already connected.
 * Shows the session URL and lets the user disconnect or continue.
 */
function BridgeDisconnectDialog({ onDone }: { onDone: LocalJSXCommandOnDone }) {
  useRegisterOverlay("bridge-disconnect-dialog");
  const setAppState = useSetAppState();
  const sessionUrl = useAppState(s => s.replBridgeSessionUrl);
  const connectUrl = useAppState(s => s.replBridgeConnectUrl);
  const sessionActive = useAppState(s => s.replBridgeSessionActive);
  const [focusIndex, setFocusIndex] = useState(2);
  const [showQR, setShowQR] = useState(false);
  const [qrText, setQrText] = useState("");
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

  function handleDisconnect() {
    setAppState(prev => {
      if (!prev.replBridgeEnabled) {
        return prev;
      }
      return {
        ...prev,
        replBridgeEnabled: false,
        replBridgeExplicit: false,
        replBridgeOutboundOnly: false
      };
    });
    logEvent("tengu_bridge_command", {
      action: "disconnect" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    onDone(REMOTE_CONTROL_DISCONNECTED_MSG, {
      display: "system"
    });
  }

  function handleShowQR() {
    setShowQR(prev_0 => !prev_0);
  }

  function handleContinue() {
    onDone(undefined, {
      display: "skip"
    });
  }

  useKeybindings({
    "select:next": () => setFocusIndex(i => (i + 1) % 3),
    "select:previous": () => setFocusIndex(i_0 => (i_0 - 1 + 3) % 3),
    "select:accept": () => {
      if (focusIndex === 0) {
        handleDisconnect();
      } else {
        if (focusIndex === 1) {
          handleShowQR();
        } else {
          handleContinue();
        }
      }
    }
  }, {
    context: "Select"
  });

  const qrLines = qrText ? qrText.split("\n").filter(l => l.length > 0) : [];

  return (
    <Dialog title="Remote Control" onCancel={handleContinue} hideInputGuide={true}>
      <Box flexDirection="column" gap={1}>
        <Text>This session is available via Remote Control{displayUrl ? ` at ${displayUrl}` : ""}.</Text>
        {showQR && qrLines.length > 0 && <Box flexDirection="column">{qrLines.map((line, i_1) => <Text key={i_1}>{line}</Text>)}</Box>}
        <Box flexDirection="column">
          <ListItem isFocused={focusIndex === 0}><Text>Disconnect this session</Text></ListItem>
          <ListItem isFocused={focusIndex === 1}><Text>{showQR ? "Hide QR code" : "Show QR code"}</Text></ListItem>
          <ListItem isFocused={focusIndex === 2}><Text>Continue</Text></ListItem>
        </Box>
        <Text dimColor={true}>Enter to select · Esc to continue</Text>
      </Box>
    </Dialog>
  );
}

/**
 * Check bridge prerequisites. Returns an error message if a precondition
 * fails, or null if all checks pass. Awaits GrowthBook init if the disk
 * cache is stale, so a user who just became entitled (e.g. upgraded to Max,
 * or the flag just launched) gets an accurate result on the first try.
 */
async function checkBridgePrerequisites(): Promise<string | null> {
  // Check organization policy — remote control may be disabled
  const {
    waitForPolicyLimitsToLoad,
    isPolicyAllowed
  } = await import('../../services/policyLimits/index.js');
  await waitForPolicyLimitsToLoad();
  if (!isPolicyAllowed('allow_remote_control')) {
    return "Remote Control is disabled by your organization's policy.";
  }
  const disabledReason = await getBridgeDisabledReason();
  if (disabledReason) {
    return disabledReason;
  }

  // Mirror the v1/v2 branching logic in initReplBridge: env-less (v2) is used
  // only when the flag is on AND the session is not perpetual.  In assistant
  // mode (KAIROS) useReplBridge sets perpetual=true, which forces
  // initReplBridge onto the v1 path — so the prerequisite check must match.
  let useV2 = isEnvLessBridgeEnabled();
  if (feature('KAIROS') && useV2) {
    const {
      isAssistantMode
    } = await import('../../assistant/index.js');
    if (isAssistantMode()) {
      useV2 = false;
    }
  }
  const versionError = useV2 ? await checkEnvLessBridgeMinVersion() : checkBridgeMinVersion();
  if (versionError) {
    return versionError;
  }
  if (!getBridgeAccessToken()) {
    return BRIDGE_LOGIN_INSTRUCTION;
  }
  logForDebugging('[bridge] Prerequisites passed, enabling bridge');
  return null;
}
export async function call(onDone: LocalJSXCommandOnDone, _context: ToolUseContext & LocalJSXCommandContext, args: string): Promise<React.ReactNode> {
  const name = args.trim() || undefined;
  return <BridgeToggle onDone={onDone} name={name} />;
}
