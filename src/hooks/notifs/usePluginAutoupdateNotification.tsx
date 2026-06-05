import * as React from 'react';
import { useEffect, useState } from 'react';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import { useNotifications } from '../../context/notifications.js';
import { Text } from '../../ink.js';
import { logForDebugging } from '../../utils/debug.js';
import { onPluginsAutoUpdated } from '../../utils/plugins/pluginAutoupdate.js';

/**
 * Hook that displays a notification when plugins have been auto-updated.
 * The notification tells the user to run /reload-plugins to apply the updates.
 */
export function usePluginAutoupdateNotification() {
  const {
    addNotification
  } = useNotifications();
  const [updatedPlugins, setUpdatedPlugins] = useState<string[]>([]);
  useEffect(() => {
    if (getIsRemoteMode()) {
      return;
    }
    const unsubscribe = onPluginsAutoUpdated(plugins => {
      logForDebugging(`Plugin autoupdate notification: ${plugins.length} plugin(s) updated`);
      setUpdatedPlugins(plugins);
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (getIsRemoteMode()) {
      return;
    }
    if (updatedPlugins.length === 0) {
      return;
    }
    const pluginNames = updatedPlugins.map(_temp);
    const displayNames = pluginNames.length <= 2 ? pluginNames.join(" and ") : `${pluginNames.length} plugins`;
    addNotification({
      key: "plugin-autoupdate-restart",
      jsx: <><Text color="success">{pluginNames.length === 1 ? "Plugin" : "Plugins"} updated:{" "}{displayNames}</Text><Text dimColor={true}> · Run /reload-plugins to apply</Text></>,
      priority: "low",
      timeoutMs: 10000
    });
    logForDebugging(`Showing plugin autoupdate notification for: ${pluginNames.join(", ")}`);
  }, [updatedPlugins, addNotification]);
}
function _temp(id: string) {
  const atIndex = id.indexOf("@");
  return atIndex > 0 ? id.substring(0, atIndex) : id;
}
