#!/usr/bin/env bun
// Interactive entry for the vendored clpzcode TUI frontend.
//
// Mirrors the TUI entry startInteractive(): build the <App> tree, backed
// by the AgentBridge (Agent re-export) that drives the clpzcode engine. Two
// mount paths share the same element:
//   - startInteractive(): standalone native @opentui renderer (createCliRenderer
//     + @opentui/react createRoot) — mirrors the TUI entry exactly.
//   - mountOnRoot(): renders the SAME tree onto an already-created clpzcode
//     adapter Root (src/ink.ts), so the clpzcode CLI launches the TUI through its
//     existing native @opentui renderer — one renderer, no second TTY handoff.

import { createElement, type ReactNode } from "react";
import { Agent } from "./agent/agent";
import {
  getApiKey,
  getBaseURL,
  getCurrentSandboxMode,
  getCurrentSandboxSettings,
} from "./utils/settings";

export interface StartInteractiveOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  maxToolRounds?: number;
  initialMessage?: string;
  version?: string;
  onExit?: () => void;
}

// Builds the <App> element + its Agent, resolving config from clpzcode settings.
// `onExit` is the App's exit callback (caller decides what teardown it triggers).
async function buildApp(
  opts: StartInteractiveOptions,
  onExit: (agent: InstanceType<typeof Agent>) => void,
): Promise<ReactNode> {
  const apiKey = opts.apiKey ?? getApiKey();
  const baseURL = opts.baseURL ?? getBaseURL();
  // Interactive sessions run unbounded so a single user turn can drive tools for
  // hours. Explicit opt-in still wins: opts.maxToolRounds (headless mount) or
  // the CLPZ_MAX_TOOL_ROUNDS env var. undefined disables the maxTurns guard in
  // query.ts. The scheduled/cron path runs as a separate headless process
  // (schedule.ts) and is unaffected by this interactive default.
  const envCap = Number(process.env.CLPZ_MAX_TOOL_ROUNDS);
  const maxToolRounds =
    opts.maxToolRounds ?? (Number.isFinite(envCap) && envCap > 0 ? envCap : undefined);
  const sandboxMode = getCurrentSandboxMode();
  const sandboxSettings = getCurrentSandboxSettings();

  const agent = new Agent(apiKey, baseURL, opts.model, maxToolRounds, { sandboxMode, sandboxSettings });

  // Fire-and-forget: populate the live xAI model list so the picker shows the
  // account's real Grok models. Silent + no-op when xAI is disconnected; not
  // awaited so it never delays the mount (the catalog falls back to the static
  // xAI list until this resolves).
  void import("../utils/model/multiProviderOptions.js")
    .then((m) => m.prefetchXaiModels())
    // Rebuild the memoized catalog so the picker reflects the live model list.
    .then(() => import("./models/models").then((m) => m.invalidateModelCatalog()))
    .catch(() => {});

  const { App } = await import("./ui/app");

  return createElement(App, {
    agent,
    startupConfig: {
      apiKey,
      baseURL,
      model: agent.getModel(),
      maxToolRounds,
      sandboxMode,
      sandboxSettings,
      version: opts.version ?? "0.0.0",
    },
    initialMessage: opts.initialMessage,
    onExit: () => onExit(agent),
  });
}

export async function startInteractive(opts: StartInteractiveOptions = {}): Promise<void> {
  const { createCliRenderer } = await import("@opentui/core");
  const { createRoot } = await import("@opentui/react");

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    openConsoleOnError: false,
    useKittyKeyboard: {
      disambiguate: true,
      alternateKeys: true,
    },
  });

  const element = await buildApp(opts, (agent) => {
    void agent.cleanup().finally(() => {
      renderer.destroy();
      opts.onExit?.();
    });
  });

  createRoot(renderer).render(element);
}

// Minimal shape of the clpzcode adapter Root (src/ink.ts) we depend on. Typed
// locally to avoid importing the clpzcode renderer module into the TUI subtree.
export interface MountableRoot {
  render: (node: ReactNode) => void;
  unmount: () => void;
}

// Builds the clpzcode frontend element to be mounted onto an EXISTING clpzcode adapter
// Root (src/ink.ts). The adapter already owns a native @opentui renderer (its
// render()/createRoot() go through @opentui/react), which is exactly what the TUI's
// <box>/<text>/useKeyboard need — so we reuse it instead of spinning up a second
// renderer. The App's onExit unmounts the root (renderer.destroy() → DESTROY →
// the caller's waitUntilExit resolves → graceful shutdown). Returning the element
// (rather than calling root.render here) lets the clpzcode REPL launcher keep its
// existing render → prefetch → waitUntilExit → shutdown lifecycle intact.
export async function buildRootElement(
  root: MountableRoot,
  opts: StartInteractiveOptions = {},
): Promise<ReactNode> {
  return buildApp(opts, (agent) => {
    void agent.cleanup().finally(() => {
      root.unmount();
      opts.onExit?.();
    });
  });
}
