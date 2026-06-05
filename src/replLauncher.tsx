import React from 'react';
import type { StatsStore } from './context/stats.js';
import type { Root } from './ink.js';
import type { Props as REPLProps } from './screens/REPL.js';
import type { AppState } from './state/AppStateStore.js';
import type { FpsMetrics } from './utils/fpsTracker.js';
type AppWrapperProps = {
  getFpsMetrics: () => FpsMetrics | undefined;
  stats?: StatsStore;
  initialState: AppState;
};
export async function launchRepl(root: Root, appProps: AppWrapperProps, replProps: REPLProps, renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>): Promise<void> {
  // The clpzcode TUI is now the clpzcode TUI frontend (src/clpz-ui), mounted on the
  // adapter Root's native @opentui renderer and driven by the AgentBridge
  // (clpzcode engine). The legacy <App><REPL/></App> tree is no longer rendered;
  // this single funnel redirects every interactive session to the clpzcode App while
  // preserving renderAndRun's render → prefetch → waitUntilExit → shutdown cycle.
  void appProps;
  void replProps;
  const {
    buildRootElement
  } = await import('./clpz-ui/entry.js');
  const element = await buildRootElement(root, {
    version: MACRO.VERSION
  });
  await renderAndRun(root, element);
}
