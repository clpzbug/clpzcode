import { join } from 'path';
import React, { type ReactNode } from 'react';
import { Box } from '../../../../ink.js';
import { getClaudeConfigHomeDir } from '../../../../utils/envUtils.js';
import type { SettingSource } from '../../../../utils/settings/constants.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Select } from '../../../CustomSelect/select.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import type { AgentWizardData } from '../types.js';
export function LocationStep() {
  const { goNext, updateWizardData, cancel } = useWizard();
  const locationOptions = [{
    label: "Project (.clpzcode/agents/)",
    value: "projectSettings" as SettingSource
  }, {
    label: `Personal (${join(getClaudeConfigHomeDir(), 'agents')})`,
    value: "userSettings" as SettingSource
  }];
  const footer = <Byline><KeyboardShortcutHint shortcut={"↑↓"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline>;
  const onChange = (value: SettingSource) => {
    updateWizardData({
      location: value as SettingSource
    });
    goNext();
  };
  const onCancel = () => cancel();
  return <WizardDialogLayout subtitle="Choose location" footerText={footer}><Box><Select key="location-select" options={locationOptions} onChange={onChange} onCancel={onCancel} /></Box></WizardDialogLayout>;
}
