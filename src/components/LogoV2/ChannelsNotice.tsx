// Conditionally require()'d in LogoV2.tsx behind feature('KAIROS') ||
// feature('KAIROS_CHANNELS'). No feature() guard here — the whole file
// tree-shakes via the require pattern when both flags are false (see
// docs/feature-gating.md). Do NOT import this module statically from
// unguarded code.

import * as React from 'react';
import { useState } from 'react';
import { type ChannelEntry, getAllowedChannels, getHasDevChannels } from '../../bootstrap/state.js';
import { Box, Text } from '../../ink.js';
import { isChannelsEnabled } from '../../services/mcp/channelAllowlist.js';
import { getEffectiveChannelAllowlist } from '../../services/mcp/channelNotification.js';
import { getMcpConfigsByScope } from '../../services/mcp/config.js';
import { getClaudeAIOAuthTokens, getSubscriptionType } from '../../utils/auth.js';
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js';
import { getSettingsForSource } from '../../utils/settings/settings.js';

export function ChannelsNotice() {
  const [state] = useState(computeChannelsState);
  const { channels, disabled, noAuth, policyBlocked, list, unmatched } = state;
  if (channels.length === 0) {
    return null;
  }
  const hasNonDev = channels.some(c => !c.dev);
  const flag = getHasDevChannels() && hasNonDev ? "Channels" : getHasDevChannels() ? "--dangerously-load-development-channels" : "--channels";
  if (disabled) {
    return (
      <Box paddingLeft={2} flexDirection="column">
        <Text color="error">{flag} ignored ({list})</Text>
        <Text dimColor={true}>Channels are not currently available</Text>
      </Box>
    );
  }
  if (noAuth) {
    return (
      <Box paddingLeft={2} flexDirection="column">
        <Text color="error">{flag} ignored ({list})</Text>
        <Text dimColor={true}>Channels require claude.ai authentication · run /login, then restart</Text>
      </Box>
    );
  }
  if (policyBlocked) {
    return (
      <Box paddingLeft={2} flexDirection="column">
        <Text color="error">{flag} blocked by org policy ({list})</Text>
        <Text dimColor={true}>Inbound messages will be silently dropped</Text>
        <Text dimColor={true}>Have an administrator set channelsEnabled: true in managed settings to enable</Text>
        {unmatched.map(u => <Text key={`${formatEntry(u.entry)}:${u.why}`} color="warning">{formatEntry(u.entry)} · {u.why}</Text>)}
      </Box>
    );
  }
  return (
    <Box paddingLeft={2} flexDirection="column">
      <Text color="error">Listening for channel messages from: {list}</Text>
      <Text dimColor={true}>Experimental · inbound messages will be pushed into this session, this carries prompt injection risks. Restart clpzcode without {flag} to disable.</Text>
      {unmatched.map(u => <Text key={`${formatEntry(u.entry)}:${u.why}`} color="warning">{formatEntry(u.entry)} · {u.why}</Text>)}
    </Box>
  );
}

function computeChannelsState() {
  const ch = getAllowedChannels();
  if (ch.length === 0) {
    return {
      channels: ch,
      disabled: false,
      noAuth: false,
      policyBlocked: false,
      list: "",
      unmatched: [] as Unmatched[]
    };
  }
  const l = ch.map(formatEntry).join(", ");
  const sub = getSubscriptionType();
  const managed = sub === "team" || sub === "enterprise";
  const policy = getSettingsForSource("policySettings");
  const allowlist = getEffectiveChannelAllowlist(sub, policy?.allowedChannelPlugins);
  return {
    channels: ch,
    disabled: !isChannelsEnabled(),
    noAuth: !getClaudeAIOAuthTokens()?.accessToken,
    policyBlocked: managed && policy?.channelsEnabled !== true,
    list: l,
    unmatched: findUnmatched(ch, allowlist)
  };
}

function formatEntry(c: ChannelEntry): string {
  return c.kind === 'plugin' ? `plugin:${c.name}@${c.marketplace}` : `server:${c.name}`;
}

type Unmatched = {
  entry: ChannelEntry;
  why: string;
};

function findUnmatched(entries: readonly ChannelEntry[], allowlist: ReturnType<typeof getEffectiveChannelAllowlist>): Unmatched[] {
  // Server-kind: build one Set from all scopes up front. getMcpConfigsByScope
  // is not cached (project scope walks the dir tree); getMcpConfigByName would
  // redo that walk per entry.
  const scopes = ['enterprise', 'user', 'project', 'local'] as const;
  const configured = new Set<string>();
  for (const scope of scopes) {
    for (const name of Object.keys(getMcpConfigsByScope(scope).servers)) {
      configured.add(name);
    }
  }

  // Plugin-kind installed check: installed_plugins.json keys are
  // `name@marketplace`. loadInstalledPluginsV2 is cached.
  const installedPluginIds = new Set(Object.keys(loadInstalledPluginsV2().plugins));

  // Plugin-kind allowlist check: same {marketplace, plugin} test as the
  // gate at channelNotification.ts. entry.dev bypasses (dev flag opts out
  // of the allowlist). Org list replaces ledger when set (team/enterprise).
  // GrowthBook _CACHED_MAY_BE_STALE — cold cache yields [] so every plugin
  // entry warns; same tradeoff the gate already accepts.
  const {
    entries: allowed,
    source
  } = allowlist;

  // Independent ifs — a plugin entry that's both uninstalled AND
  // unlisted shows two lines. Server kind checks config + dev flag.
  const out: Unmatched[] = [];
  for (const entry of entries) {
    if (entry.kind === 'server') {
      if (!configured.has(entry.name)) {
        out.push({
          entry,
          why: 'no MCP server configured with that name'
        });
      }
      if (!entry.dev) {
        out.push({
          entry,
          why: 'server: entries need --dangerously-load-development-channels'
        });
      }
      continue;
    }
    if (!installedPluginIds.has(`${entry.name}@${entry.marketplace}`)) {
      out.push({
        entry,
        why: 'plugin not installed'
      });
    }
    if (!entry.dev && !allowed.some(e => e.plugin === entry.name && e.marketplace === entry.marketplace)) {
      out.push({
        entry,
        why: source === 'org' ? "not on your org's approved channels list" : 'not on the approved channels allowlist'
      });
    }
  }
  return out;
}
