import * as React from 'react';
import { useState } from 'react';
import { useInterval } from 'usehooks-ts';
import { Text } from '../ink.js';
import { type AutoUpdaterResult, getLatestVersionFromGcs, getMaxVersion, shouldSkipVersion } from '../utils/autoUpdater.js';
import { isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getPackageManager, type PackageManager } from '../utils/nativeInstaller/packageManagers.js';
import { gt, gte } from '../utils/semver.js';
import { getInitialSettings } from '../utils/settings/settings.js';
type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
};
export function PackageManagerAutoUpdater({ verbose }: Props) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [packageManager, setPackageManager] = useState<PackageManager>("unknown");
  const checkForUpdates = async () => {
    false || false;
    if (isAutoUpdaterDisabled()) {
      return;
    }
    const [channel, pm] = await Promise.all([Promise.resolve(getInitialSettings()?.autoUpdatesChannel ?? "latest"), getPackageManager()]);
    setPackageManager(pm);
    let latest = await getLatestVersionFromGcs(channel);
    const maxVersion = await getMaxVersion();
    if (maxVersion && latest && gt(latest, maxVersion)) {
      logForDebugging(`PackageManagerAutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latest} to ${maxVersion}`);
      if (gte(MACRO.VERSION, maxVersion)) {
        logForDebugging(`PackageManagerAutoUpdater: current version ${MACRO.VERSION} is already at or above maxVersion ${maxVersion}, skipping update`);
        setUpdateAvailable(false);
        return;
      }
      latest = maxVersion;
    }
    const hasUpdate = latest && !gte(MACRO.VERSION, latest) && !shouldSkipVersion(latest);
    setUpdateAvailable(!!hasUpdate);
    if (hasUpdate) {
      logForDebugging(`PackageManagerAutoUpdater: Update available ${MACRO.VERSION} -> ${latest}`);
    }
  };
  React.useEffect(() => {
    checkForUpdates();
  }, [checkForUpdates]);
  useInterval(checkForUpdates, 1800000);
  if (!updateAvailable) {
    return null;
  }
  const updateCommand = packageManager === "homebrew" ? "brew upgrade claude-code" : packageManager === "winget" ? "winget upgrade Anthropic.ClaudeCode" : packageManager === "apk" ? "apk upgrade claude-code" : "your package manager update command";
  return <>{verbose && <Text dimColor={true} wrap="truncate">currentVersion: {MACRO.VERSION}</Text>}<Text color="warning" wrap="truncate">Update available! Run: <Text bold={true}>{updateCommand}</Text></Text></>;
}
