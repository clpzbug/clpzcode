/** @jsxImportSource @opentui/react */
import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import {
  type ActivityItem,
  type ActivityKind,
  aggregateTokens,
  runningCount,
} from "../activity";
import type { Theme } from "./theme";

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function elapsedOf(item: ActivityItem, nowMs: number): number {
  return (item.endTime ?? nowMs) - item.startTime;
}

// Compact, readable model tag: Claude full ids collapse to their tier; xAI and
// other ids keep their name (provider prefix stripped).
function shortModel(m: string): string {
  const s = m.toLowerCase();
  if (s.includes("opus")) return "opus";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("haiku")) return "haiku";
  return m.replace(/^.*\//, "");
}

// Right-aligned per-row stats: "12K · 8 tools · 4m". Tokens/tools omitted when
// the source has no attribution (shells, workflows) so we never show a fake 0.
function itemStats(item: ActivityItem, nowMs: number): string {
  const parts: string[] = [];
  if (item.kind === "workflow" && item.childTotal) {
    parts.push(`${item.childRunning ?? 0}/${item.childTotal} agents`);
  }
  if (typeof item.tokens === "number" && item.tokens > 0) parts.push(formatTokens(item.tokens));
  if (typeof item.toolUses === "number" && item.toolUses > 0) parts.push(`${item.toolUses} tools`);
  parts.push(formatElapsed(elapsedOf(item, nowMs)));
  return parts.join(" · ");
}

const KIND_ORDER: ActivityKind[] = [
  "agent",
  "teammate",
  "workflow",
  "shell",
  "monitor",
  "remote",
  "mcp",
  "dream",
];

const SECTION_TITLE: Record<ActivityKind, string> = {
  agent: "Agents",
  teammate: "Teammates",
  workflow: "Workflows",
  shell: "Shells",
  monitor: "Monitors",
  remote: "Remote",
  mcp: "Monitors (MCP)",
  dream: "Dream",
};

function statusColor(item: ActivityItem, t: Theme): string {
  if (item.status === "running") return t.subagentAccent;
  if (item.status === "pending") return t.textMuted;
  return t.textDim;
}

/**
 * Always-on compact footer indicator. Renders nothing when nothing is running,
 * so the footer collapses cleanly. Shows running count, summed agent tokens,
 * and the longest-running elapsed time.
 */
export function ActivityPill({
  t,
  items,
  nowMs,
}: {
  t: Theme;
  items: ActivityItem[];
  nowMs: number;
}) {
  const running = runningCount(items);
  if (running === 0) return null;

  const tokens = aggregateTokens(items);
  let maxElapsed = 0;
  for (const it of items) {
    if (it.status !== "running") continue;
    const e = elapsedOf(it, nowMs);
    if (e > maxElapsed) maxElapsed = e;
  }

  return (
    <text>
      <span style={{ fg: t.subagentAccent }}>{"◆ "}</span>
      <span style={{ fg: t.text }}>{String(running)}</span>
      <span style={{ fg: t.textMuted }}>{running === 1 ? " task" : " tasks"}</span>
      {tokens > 0 ? <span style={{ fg: t.textDim }}>{` · ${formatTokens(tokens)}`}</span> : null}
      <span style={{ fg: t.textDim }}>{` · ${formatElapsed(maxElapsed)}`}</span>
    </text>
  );
}

function ActivityRow({
  t,
  item,
  selected,
  nowMs,
  maxTitle,
}: {
  t: Theme;
  item: ActivityItem;
  selected: boolean;
  nowMs: number;
  maxTitle: number;
}) {
  const title = item.title.length > maxTitle ? `${item.title.slice(0, maxTitle - 1)}…` : item.title;
  return (
    <box
      id={`activity-${item.id}`}
      width="100%"
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={selected ? t.selectedBg : undefined}
      paddingLeft={2}
      paddingRight={2}
    >
      <box flexDirection="row" flexShrink={1} minWidth={0}>
        <text fg={selected ? t.primary : t.textMuted}>{selected ? "› " : "  "}</text>
        <text fg={statusColor(item, t)}>{"● "}</text>
        <text fg={selected ? t.primary : t.text}>{title}</text>
      </box>
      <text>
        {item.model ? <span style={{ fg: t.accent }}>{`${shortModel(item.model)}  `}</span> : null}
        <span style={{ fg: t.textMuted }}>{itemStats(item, nowMs)}</span>
      </text>
    </box>
  );
}

/**
 * Expandable activity panel. Structurally cloned from SubagentsBrowserModal:
 * absolute overlay, centered panel, scrollable list. Rows are grouped by kind
 * with section headers; selection indexes the flat `items` array so ↑/↓ moves
 * visually downward through every row.
 */
export function ActivityPanel({
  t,
  width,
  height,
  items,
  selectedIndex,
  nowMs,
}: {
  t: Theme;
  width: number;
  height: number;
  items: ActivityItem[];
  selectedIndex: number;
  nowMs: number;
}) {
  const listRef = useRef<ScrollBoxRenderable>(null);

  useEffect(() => {
    const selected = items[selectedIndex];
    if (!selected) return;
    listRef.current?.scrollChildIntoView(`activity-${selected.id}`);
  }, [items, selectedIndex]);

  const panelWidth = Math.min(76, width - 6);
  const maxTitle = Math.max(16, panelWidth - 30);
  const contentHeight = items.length + KIND_ORDER.length + 8;
  const panelHeight = Math.min(contentHeight, Math.floor(height * 0.7));
  const overlayBg = "#000000cc" as string;
  const paddingTop = Math.max(2, Math.floor((height - panelHeight) / 2));

  const running = runningCount(items);
  const selected = items[selectedIndex];

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={paddingTop}
      backgroundColor={overlayBg}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box
          flexShrink={0}
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg={t.primary}>
            <b>{"Activity"}</b>
            <span style={{ fg: t.textMuted }}>
              {running > 0 ? `  ${running} running` : "  idle"}
            </span>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>

        <scrollbox ref={listRef} flexGrow={1} minHeight={0} paddingTop={1}>
          {items.length === 0 ? (
            <box paddingLeft={2} paddingRight={2}>
              <text fg={t.textMuted}>{"No agents, workflows or shells running"}</text>
            </box>
          ) : (
            KIND_ORDER.flatMap((kind) => {
              const group = items
                .map((item, idx) => ({ item, idx }))
                .filter(({ item }) => item.kind === kind);
              if (group.length === 0) return [];
              return [
                <box key={`hdr-${kind}`} paddingLeft={2} paddingRight={2} paddingTop={1}>
                  <text fg={t.textDim}>
                    <b>{SECTION_TITLE[kind]}</b>
                    {` (${group.length})`}
                  </text>
                </box>,
                ...group.map(({ item, idx }) => (
                  <ActivityRow
                    key={item.id}
                    t={t}
                    item={item}
                    selected={idx === selectedIndex}
                    nowMs={nowMs}
                    maxTitle={maxTitle}
                  />
                )),
              ];
            })
          )}
        </scrollbox>

        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text>
            <span style={{ fg: t.primary }}>{"↑↓ "}</span>
            <span style={{ fg: t.textMuted }}>{"select · "}</span>
            <span style={{ fg: selected?.killable ? t.primary : t.textDim }}>{"x "}</span>
            <span style={{ fg: t.textMuted }}>{"stop · "}</span>
            <span style={{ fg: t.primary }}>{"esc "}</span>
            <span style={{ fg: t.textMuted }}>{"close"}</span>
          </text>
        </box>
      </box>
    </box>
  );
}
