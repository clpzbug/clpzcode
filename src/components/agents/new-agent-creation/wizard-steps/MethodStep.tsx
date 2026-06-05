import React, { type ReactNode } from 'react';
import { PRODUCT_DISPLAY_NAME } from '../../../../constants/product.js';
import { Box } from '../../../../ink.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Select } from '../../../CustomSelect/select.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import type { AgentWizardData } from '../types.js';
export function MethodStep() {
  const {
    goNext,
    goBack,
    updateWizardData,
    goToStep
  } = useWizard();
  const methodOptions = [{
    label: `Generate with ${PRODUCT_DISPLAY_NAME} (recommended)`,
    value: "generate"
  }, {
    label: "Manual configuration",
    value: "manual"
  }];
  const footerText: ReactNode = <Byline><KeyboardShortcutHint shortcut={"↑↓"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" /></Byline>;
  const onChange = (value: string) => {
    const method = value as 'generate' | 'manual';
    updateWizardData({
      method,
      wasGenerated: method === "generate"
    });
    if (method === "generate") {
      goNext();
    } else {
      goToStep(3);
    }
  };
  const onCancel = () => goBack();
  return <WizardDialogLayout subtitle="Creation method" footerText={footerText}><Box><Select key="method-select" options={methodOptions} onChange={onChange} onCancel={onCancel} /></Box></WizardDialogLayout>;
}
