/** @jsxImportSource @opentui/react */
import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { ActivityItem } from "../activity";
import { ActivityPanel, ActivityPill } from "./activity-modal";
import { dark } from "./theme";

const NOW = 1_000_000;

function item(over: Partial<ActivityItem> & Pick<ActivityItem, "id" | "kind" | "title">): ActivityItem {
  return { status: "running", startTime: NOW - 240_000, killable: true, ...over };
}

async function frameOf(node: React.ReactNode, width: number, height: number): Promise<string> {
  const { captureCharFrame, flush } = await testRender(node, { width, height });
  await flush();
  return captureCharFrame();
}

describe("ActivityPill (real OpenTUI frame)", () => {
  it("draws count, summed tokens and longest elapsed", async () => {
    const frame = await frameOf(
      <box>
        <ActivityPill
          t={dark}
          items={[
            item({ id: "a1", kind: "agent", title: "x", tokens: 12000 }),
            item({ id: "a2", kind: "agent", title: "y", tokens: 8000, startTime: NOW - 600_000 }),
          ]}
          nowMs={NOW}
        />
      </box>,
      60,
      4,
    );
    expect(frame).toContain("2");
    expect(frame).toContain("tasks");
    expect(frame).toContain("20K");
    expect(frame).toContain("10m"); // longest-running of the two
  });

  it("renders nothing when nothing is running", async () => {
    const frame = await frameOf(
      <box>
        <ActivityPill
          t={dark}
          items={[item({ id: "d1", kind: "agent", title: "done", status: "completed", killable: false })]}
          nowMs={NOW}
        />
      </box>,
      60,
      4,
    );
    expect(frame).not.toContain("task");
    expect(frame.trim()).toBe("");
  });
});

describe("ActivityPanel (real OpenTUI frame)", () => {
  const items: ActivityItem[] = [
    item({ id: "a1", kind: "agent", title: "scan targets", model: "claude-opus-4-8", tokens: 12000, toolUses: 8 }),
    item({ id: "a2", kind: "agent", title: "bulk search", model: "grok-4.3", tokens: 40000, toolUses: 12 }),
    item({ id: "s1", kind: "shell", title: "npm run build" }),
    item({ id: "w1", kind: "workflow", title: "audit run", childRunning: 2, childTotal: 3 }),
  ];

  it("draws title, grouped sections, per-row stats and action hints", async () => {
    const frame = await frameOf(
      <ActivityPanel t={dark} width={90} height={26} items={items} selectedIndex={0} nowMs={NOW} />,
      90,
      26,
    );
    expect(frame).toContain("Activity");
    expect(frame).toContain("4 running");
    // grouped section headers
    expect(frame).toContain("Agents");
    expect(frame).toContain("Shells");
    expect(frame).toContain("Workflows");
    // rows + per-row stats
    expect(frame).toContain("scan targets");
    expect(frame).toContain("12K");
    expect(frame).toContain("8 tools");
    // per-agent model tag: claude id collapses to its tier, grok id passes through
    expect(frame).toContain("opus");
    expect(frame).toContain("grok-4.3");
    expect(frame).toContain("npm run build");
    expect(frame).toContain("audit run");
    expect(frame).toContain("2/3 agents");
    // action hints
    expect(frame).toContain("select");
    expect(frame).toContain("stop");
    expect(frame).toContain("close");
  });

  it("shows the empty state when nothing is running", async () => {
    const frame = await frameOf(
      <ActivityPanel t={dark} width={90} height={26} items={[]} selectedIndex={0} nowMs={NOW} />,
      90,
      26,
    );
    expect(frame).toContain("Activity");
    expect(frame).toContain("idle");
    expect(frame).toContain("No agents, workflows or shells running");
  });
});
