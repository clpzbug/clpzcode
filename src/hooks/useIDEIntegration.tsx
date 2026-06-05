import { useEffect } from 'react';
import type { ScopedMcpServerConfig } from '../services/mcp/types.js';
import { getGlobalConfig } from '../utils/config.js';
import { isEnvDefinedFalsy, isEnvTruthy } from '../utils/envUtils.js';
import type { DetectedIDEInfo } from '../utils/ide.js';
import { type IDEExtensionInstallationStatus, type IdeType, initializeIdeIntegration, isSupportedTerminal } from '../utils/ide.js';
type UseIDEIntegrationProps = {
  autoConnectIdeFlag?: boolean;
  ideToInstallExtension: IdeType | null;
  setDynamicMcpConfig: React.Dispatch<React.SetStateAction<Record<string, ScopedMcpServerConfig> | undefined>>;
  setShowIdeOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
  setIDEInstallationState: React.Dispatch<React.SetStateAction<IDEExtensionInstallationStatus | null>>;
};
export function useIDEIntegration({
  autoConnectIdeFlag,
  ideToInstallExtension,
  setDynamicMcpConfig,
  setShowIdeOnboarding,
  setIDEInstallationState
}: UseIDEIntegrationProps) {
  useEffect(() => {
    const addIde = function addIde(ide: DetectedIDEInfo | null) {
      if (!ide) {
        return;
      }
      const globalConfig = getGlobalConfig();
      const autoConnectEnabled = (globalConfig.autoConnectIde || autoConnectIdeFlag || isSupportedTerminal() || process.env.CLAUDE_CODE_SSE_PORT || ideToInstallExtension || isEnvTruthy(process.env.CLAUDE_CODE_AUTO_CONNECT_IDE)) && !isEnvDefinedFalsy(process.env.CLAUDE_CODE_AUTO_CONNECT_IDE);
      if (!autoConnectEnabled) {
        return;
      }
      setDynamicMcpConfig(prev => {
        if (prev?.ide) {
          return prev;
        }
        return {
          ...prev,
          ide: {
            type: ide.url.startsWith("ws:") ? "ws-ide" : "sse-ide",
            url: ide.url,
            ideName: ide.name,
            authToken: ide.authToken,
            ideRunningInWindows: ide.ideRunningInWindows,
            scope: "dynamic" as const
          }
        };
      });
    };
    initializeIdeIntegration(addIde, ideToInstallExtension, () => setShowIdeOnboarding(true), status => setIDEInstallationState(status));
  }, [autoConnectIdeFlag, ideToInstallExtension, setDynamicMcpConfig, setShowIdeOnboarding, setIDEInstallationState]);
}
