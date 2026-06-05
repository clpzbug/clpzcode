import React, { useEffect, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { Box, Link, Text, useInput } from '../../ink.js';
import { type AccountSettings, calculateShouldShowGrove, type GroveConfig, getGroveNoticeConfig, getGroveSettings, markGroveNoticeViewed, updateGroveSettings } from '../../services/api/grove.js';
import { Select } from '../CustomSelect/index.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
export type GroveDecision = 'accept_opt_in' | 'accept_opt_out' | 'defer' | 'escape' | 'skip_rendering';
type Props = {
  showIfAlreadyViewed: boolean;
  location: 'settings' | 'policy_update_modal' | 'onboarding';
  onDone(decision: GroveDecision): void;
};
const NEW_TERMS_ASCII = ` _____________
 |          \\  \\
 | NEW TERMS \\__\\
 |              |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |              |
 |______________|`;
function GracePeriodContentBody() {
  return <><Text>An update to our Consumer Terms and Privacy Policy will take effect on{" "}<Text bold={true}>October 8, 2025</Text>. You can accept the updated terms today.</Text><Box flexDirection="column"><Text>What's changing?</Text><Box paddingLeft={1}><Text><Text>· </Text><Text bold={true}>You can help improve Claude </Text><Text>— Allow the use of your chats and coding sessions to train and improve Anthropic AI models. Change anytime in your Privacy Settings (<Link url="https://claude.ai/settings/data-privacy-controls" />).</Text></Text></Box><Box paddingLeft={1}><Text><Text>· </Text><Text bold={true}>Updates to data retention </Text><Text>— To help us improve our AI models and safety protections, we're extending data retention to 5 years.</Text></Text></Box></Box><Text>Learn more (<Link url="https://www.anthropic.com/news/updates-to-our-consumer-terms" />) or read the updated Consumer Terms (<Link url="https://anthropic.com/legal/terms" />) and Privacy Policy (<Link url="https://anthropic.com/legal/privacy" />)</Text></>;
}
function PostGracePeriodContentBody() {
  return <><Text>We've updated our Consumer Terms and Privacy Policy.</Text><Box flexDirection="column" gap={1}><Text>What's changing?</Text><Box flexDirection="column"><Text bold={true}>Help improve Claude</Text><Text>Allow the use of your chats and coding sessions to train and improve Anthropic AI models. You can change this anytime in Privacy Settings</Text><Link url="https://claude.ai/settings/data-privacy-controls" /></Box><Box flexDirection="column"><Text bold={true}>How this affects data retention</Text><Text>Turning ON the improve Claude setting extends data retention from 30 days to 5 years. Turning it OFF keeps the default 30-day data retention. Delete data anytime.</Text></Box></Box><Text>Learn more (<Link url="https://www.anthropic.com/news/updates-to-our-consumer-terms" />) or read the updated Consumer Terms (<Link url="https://anthropic.com/legal/terms" />) and Privacy Policy (<Link url="https://anthropic.com/legal/privacy" />)</Text></>;
}
export function GroveDialog({ showIfAlreadyViewed, location, onDone }: Props) {
  const [shouldShowDialog, setShouldShowDialog] = useState<boolean | null>(null);
  const [groveConfig, setGroveConfig] = useState<GroveConfig | null>(null);
  useEffect(() => {
    const checkGroveSettings = async function checkGroveSettings() {
      const [settingsResult, configResult] = await Promise.all([getGroveSettings(), getGroveNoticeConfig()]);
      const config = configResult.success ? configResult.data : null;
      setGroveConfig(config);
      const shouldShow = calculateShouldShowGrove(settingsResult, configResult, showIfAlreadyViewed);
      setShouldShowDialog(shouldShow);
      if (!shouldShow) {
        onDone("skip_rendering");
        return;
      }
      markGroveNoticeViewed();
      logEvent("tengu_grove_policy_viewed", {
        location: location as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        dismissable: config?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    };
    checkGroveSettings();
  }, [showIfAlreadyViewed, location, onDone]);
  if (shouldShowDialog === null) {
    return null;
  }
  if (!shouldShowDialog) {
    return null;
  }
  const onChange = async function onChange(value) {
    bb21: switch (value) {
      case "accept_opt_in":
        {
          await updateGroveSettings(true);
          logEvent("tengu_grove_policy_submitted", {
            state: true,
            dismissable: groveConfig?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          break bb21;
        }
      case "accept_opt_out":
        {
          await updateGroveSettings(false);
          logEvent("tengu_grove_policy_submitted", {
            state: false,
            dismissable: groveConfig?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          break bb21;
        }
      case "defer":
        {
          logEvent("tengu_grove_policy_dismissed", {
            state: true
          });
          break bb21;
        }
      case "escape":
        {
          logEvent("tengu_grove_policy_escaped", {});
        }
    }
    onDone(value);
  };
  const acceptOptions = groveConfig?.domain_excluded ? [{
    label: "Accept terms \xB7 Help improve Claude: OFF (for emails with your domain)",
    value: "accept_opt_out"
  }] : [{
    label: "Accept terms \xB7 Help improve Claude: ON",
    value: "accept_opt_in"
  }, {
    label: "Accept terms \xB7 Help improve Claude: OFF",
    value: "accept_opt_out"
  }];
  const handleCancel = function handleCancel() {
    if (groveConfig?.notice_is_grace_period) {
      onChange("defer");
      return;
    }
    onChange("escape");
  };
  return <Dialog title="Updates to Consumer Terms and Policies" color="professionalBlue" onCancel={handleCancel} inputGuide={_temp}><Box flexDirection="row"><Box flexDirection="column" gap={1} flexGrow={1}>{groveConfig?.notice_is_grace_period ? <GracePeriodContentBody /> : <PostGracePeriodContentBody />}</Box><Box flexShrink={0}><Text color="professionalBlue">{NEW_TERMS_ASCII}</Text></Box></Box><Box flexDirection="column" gap={1}><Box flexDirection="column"><Text bold={true}>Please select how you'd like to continue</Text><Text>Your choice takes effect immediately upon confirmation.</Text></Box><Select options={[...acceptOptions, ...(groveConfig?.notice_is_grace_period ? [{
    label: "Not now",
    value: "defer"
  }] : [])]} onChange={value_0 => onChange(value_0 as 'accept_opt_in' | 'accept_opt_out' | 'defer')} onCancel={handleCancel} /></Box></Dialog>;
}
function _temp(exitState) {
  return exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline><KeyboardShortcutHint shortcut="Enter" action="confirm" /><KeyboardShortcutHint shortcut="Esc" action="cancel" /></Byline>;
}
type PrivacySettingsDialogProps = {
  settings: AccountSettings;
  domainExcluded?: boolean;
  onDone(): void;
};
export function PrivacySettingsDialog({ settings, domainExcluded, onDone }: PrivacySettingsDialogProps) {
  const [groveEnabled, setGroveEnabled] = useState(settings.grove_enabled);
  React.useEffect(_temp2, []);
  useInput(async (input, key) => {
    if (!domainExcluded && (key.tab || key.return || input === " ")) {
      const newValue = !groveEnabled;
      setGroveEnabled(newValue);
      await updateGroveSettings(newValue);
    }
  });
  let valueComponent = <Text color="error">false</Text>;
  if (domainExcluded) {
    valueComponent = <Text color="error">false (for emails with your domain)</Text>;
  } else {
    if (groveEnabled) {
      valueComponent = <Text color="success">true</Text>;
    }
  }
  return <Dialog title="Data Privacy" color="professionalBlue" onCancel={onDone} inputGuide={exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : domainExcluded ? <KeyboardShortcutHint shortcut="Esc" action="cancel" /> : <Byline><KeyboardShortcutHint shortcut="Enter/Tab/Space" action="toggle" /><KeyboardShortcutHint shortcut="Esc" action="cancel" /></Byline>}><Text>Review and manage your privacy settings at{" "}<Link url="https://claude.ai/settings/data-privacy-controls" /></Text><Box><Box width={44}><Text bold={true}>Help improve Claude</Text></Box><Box>{valueComponent}</Box></Box></Dialog>;
}
function _temp2() {
  logEvent("tengu_grove_privacy_settings_viewed", {});
}
