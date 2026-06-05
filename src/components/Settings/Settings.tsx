// biome-ignore-all assist/source/organizeImports: internal-only import markers must not be reordered
import * as React from 'react';
import { Suspense, useState } from 'react';
// Stub for internal-only component
const Gates: React.FC<Record<string, unknown>> = () => null
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useIsInsideModal, useModalOrTerminalSize } from '../../context/modalContext.js';
import { Pane } from '../design-system/Pane.js';
import { Tabs, Tab } from '../design-system/Tabs.js';
import { Status, buildDiagnostics } from './Status.js';
import { Config } from './Config.js';
import { Usage } from './Usage.js';
import type { LocalJSXCommandContext, CommandResultDisplay } from '../../commands.js';
type Props = {
  onClose: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  context: LocalJSXCommandContext;
  defaultTab: 'Status' | 'Config' | 'Usage' | 'Gates';
};
export function Settings({ onClose, context, defaultTab }: Props) {
  const [selectedTab, setSelectedTab] = useState<string>(defaultTab);
  const [tabsHidden, setTabsHidden] = useState(false);
  const [configOwnsEsc, setConfigOwnsEsc] = useState(false);
  const [gatesOwnsEsc, setGatesOwnsEsc] = useState(false);
  const insideModal = useIsInsideModal();
  const {
    rows
  } = useModalOrTerminalSize(useTerminalSize());
  const contentHeight = insideModal ? rows + 1 : Math.max(15, Math.min(Math.floor(rows * 0.8), 30));
  const [diagnosticsPromise] = useState(_temp2);
  useExitOnCtrlCDWithKeybindings();
  const handleEscape = () => {
    if (tabsHidden) {
      return;
    }
    onClose("Status dialog dismissed", {
      display: "system"
    });
  };
  const escapeActive = !tabsHidden && !(selectedTab === "Config" && configOwnsEsc) && !(selectedTab === "Gates" && gatesOwnsEsc);
  useKeybinding("confirm:no", handleEscape, {
    context: "Settings",
    isActive: escapeActive
  });
  const statusTab = <Tab key="status" title="Status"><Status context={context} diagnosticsPromise={diagnosticsPromise} /></Tab>;
  const configTab = <Tab key="config" title="Config"><Suspense fallback={null}><Config context={context} onClose={onClose} setTabsHidden={setTabsHidden} onIsSearchModeChange={setConfigOwnsEsc} contentHeight={contentHeight} /></Suspense></Tab>;
  const usageTab = <Tab key="usage" title="Usage"><Usage /></Tab>;
  const gatesTabs = false ? [<Tab key="gates" title="Gates"><Gates onOwnsEscChange={setGatesOwnsEsc} contentHeight={contentHeight} /></Tab>] : [];
  const tabs = [statusTab, configTab, usageTab, ...gatesTabs];
  const initialHeaderFocused = defaultTab !== "Config" && defaultTab !== "Gates";
  const tabsContentHeight = tabsHidden || insideModal ? undefined : contentHeight;
  return <Pane color="permission"><Tabs color="permission" selectedTab={selectedTab} onTabChange={setSelectedTab} hidden={tabsHidden} initialHeaderFocused={initialHeaderFocused} contentHeight={tabsContentHeight}>{tabs}</Tabs></Pane>;
}
function _temp2() {
  return buildDiagnostics().catch(_temp);
}
function _temp() {
  return [];
}
