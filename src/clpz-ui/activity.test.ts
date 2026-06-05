import { describe, expect, it } from "bun:test";
import type { TaskState } from "src/tasks/types.js";
import { aggregateTokens, runningCount, selectActivityItems, toActivityItem } from "./activity";

// Minimal task builders — cast to the union since the projection only reads a
// few fields and we don't want to fight the full DeepImmutable shapes in tests.
function task(t: Record<string, unknown>): TaskState {
  return t as unknown as TaskState;
}

function agentTask(over: Record<string, unknown> = {}): TaskState {
  return task({
    id: "a1",
    type: "local_agent",
    status: "running",
    description: "scan targets",
    agentType: "general-purpose",
    model: "opus",
    startTime: 1000,
    progress: { tokenCount: 12000, toolUseCount: 8 },
    ...over,
  });
}

describe("toActivityItem", () => {
  it("maps an agent with live tokens and tool uses", () => {
    const item = toActivityItem(agentTask())!;
    expect(item.kind).toBe("agent");
    expect(item.title).toBe("scan targets");
    expect(item.model).toBe("opus");
    expect(item.tokens).toBe(12000);
    expect(item.toolUses).toBe(8);
    expect(item.killable).toBe(true);
  });

  it("uses command for a bash shell and description for a monitor", () => {
    const bash = toActivityItem(task({ id: "b1", type: "local_bash", status: "running", command: "npm test", description: "d", startTime: 1 }))!;
    expect(bash.kind).toBe("shell");
    expect(bash.title).toBe("npm test");

    const mon = toActivityItem(task({ id: "b2", type: "local_bash", kind: "monitor", status: "running", command: "tail -f log", description: "watch log", startTime: 1 }))!;
    expect(mon.kind).toBe("monitor");
    expect(mon.title).toBe("watch log");
  });

  it("reports workflow node progress and no token attribution", () => {
    const wf = toActivityItem(task({
      id: "w1",
      type: "local_workflow",
      status: "running",
      description: "audit",
      summary: "audit — wave 1",
      startTime: 1,
      agents: [
        { id: "n1", subtask: "x", status: "running" },
        { id: "n2", subtask: "y", status: "running" },
        { id: "n3", subtask: "z", status: "done" },
      ],
    }))!;
    expect(wf.kind).toBe("workflow");
    expect(wf.title).toBe("audit — wave 1");
    expect(wf.childRunning).toBe(2);
    expect(wf.childTotal).toBe(3);
    expect(wf.tokens).toBeUndefined();
  });

  it("marks a non-running item as not killable", () => {
    const done = toActivityItem(agentTask({ status: "completed", endTime: 5000 }))!;
    expect(done.killable).toBe(false);
  });
});

describe("selectActivityItems", () => {
  it("excludes the main session and terminal tasks, keeps running/pending", () => {
    const tasks: Record<string, TaskState> = {
      a1: agentTask({ id: "a1", status: "running" }),
      main: agentTask({ id: "main", agentType: "main-session" }),
      done: agentTask({ id: "done", status: "completed" }),
      sh: task({ id: "sh", type: "local_bash", status: "pending", command: "ls", description: "d", startTime: 2 }),
    };
    const items = selectActivityItems(tasks);
    const ids = items.map(i => i.id).sort();
    expect(ids).toEqual(["a1", "sh"]);
  });

  it("sorts running before pending, then most-recent first", () => {
    const tasks: Record<string, TaskState> = {
      old: agentTask({ id: "old", status: "running", startTime: 100 }),
      newer: agentTask({ id: "newer", status: "running", startTime: 900 }),
      pend: agentTask({ id: "pend", status: "pending", startTime: 999 }),
    };
    const items = selectActivityItems(tasks);
    expect(items.map(i => i.id)).toEqual(["newer", "old", "pend"]);
  });

  it("handles an empty/undefined registry", () => {
    expect(selectActivityItems(undefined)).toEqual([]);
    expect(selectActivityItems({})).toEqual([]);
  });
});

describe("aggregates", () => {
  it("sums agent tokens and counts running items", () => {
    const items = selectActivityItems({
      a1: agentTask({ id: "a1", status: "running", progress: { tokenCount: 1000, toolUseCount: 1 } }),
      a2: agentTask({ id: "a2", status: "running", progress: { tokenCount: 2500, toolUseCount: 2 } }),
      sh: task({ id: "sh", type: "local_bash", status: "pending", command: "ls", description: "d", startTime: 2 }),
    });
    expect(aggregateTokens(items)).toBe(3500);
    expect(runningCount(items)).toBe(2);
  });
});
