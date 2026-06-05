import { describe, expect, it } from "bun:test";
import type { ChatEntry, MediaAsset } from "../types/index";
import { computeToolGroups, MIN_GROUP_RUN } from "./toolGroups";

let idSeq = 0;
function tc(name: string) {
  idSeq += 1;
  return { id: `call_${idSeq}`, type: "function" as const, function: { name, arguments: "{}" } };
}
function result(name: string): ChatEntry {
  return { type: "tool_result", content: "ok", timestamp: new Date(), toolCall: tc(name), toolResult: { success: true } };
}
function call(name: string): ChatEntry {
  return { type: "tool_call", content: "", timestamp: new Date(), toolCall: tc(name) };
}
function user(): ChatEntry {
  return { type: "user", content: "hi", timestamp: new Date() };
}
function assistant(): ChatEntry {
  return { type: "assistant", content: "thinking", timestamp: new Date() };
}
function mediaResult(name: string): ChatEntry {
  const media: MediaAsset[] = [{ kind: "image", path: "/tmp/x.png" }];
  return { type: "tool_result", content: "", timestamp: new Date(), toolCall: tc(name), toolResult: { success: true, media } };
}

describe("computeToolGroups", () => {
  it("does NOT collapse a run shorter than MIN_GROUP_RUN", () => {
    const items = computeToolGroups([result("Zsh"), result("Zsh")]);
    expect(MIN_GROUP_RUN).toBe(3);
    expect(items.every((i) => i.kind === "entry")).toBe(true);
    expect(items).toHaveLength(2);
  });

  it("collapses a run of exactly 3 same-tool results into one group", () => {
    const a = result("Zsh");
    const items = computeToolGroups([a, result("Zsh"), result("Zsh")]);
    expect(items).toHaveLength(1);
    const g = items[0]!;
    expect(g.kind).toBe("group");
    if (g.kind === "group") {
      expect(g.toolName).toBe("Zsh");
      expect(g.memberIndices).toEqual([0, 1, 2]);
      expect(g.members).toHaveLength(3);
      expect(g.latestIndex).toBe(2);
      // groupId is the FIRST member's tool_use id (stable anchor).
      expect(g.groupId).toBe(a.toolCall!.id);
    }
  });

  it("skips interleaved tool_call entries so an interleaved run still forms", () => {
    // post-turn shape: leading tool_call, then result/tool_call/result/tool_call/result
    const msgs = [call("Zsh"), result("Zsh"), call("Zsh"), result("Zsh"), call("Zsh"), result("Zsh")];
    const items = computeToolGroups(msgs);
    // leading tool_call (index 0) is a plain entry; the three results group.
    expect(items).toHaveLength(2);
    expect(items[0]!.kind).toBe("entry");
    const g = items[1]!;
    expect(g.kind).toBe("group");
    if (g.kind === "group") {
      expect(g.memberIndices).toEqual([1, 3, 5]);
      expect(g.latestIndex).toBe(5);
    }
  });

  it("breaks a run on a different tool and emits the short prefix individually", () => {
    const items = computeToolGroups([
      result("Zsh"), result("Zsh"), result("Read"), result("Zsh"), result("Zsh"), result("Zsh"),
    ]);
    // First two Zsh (len 2) + one Read => 3 plain entries; trailing three Zsh => 1 group.
    expect(items.filter((i) => i.kind === "group")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "entry")).toHaveLength(3);
    const g = items.find((i) => i.kind === "group")!;
    if (g.kind === "group") expect(g.memberIndices).toEqual([3, 4, 5]);
  });

  it("treats assistant and user entries as hard run boundaries", () => {
    const withAssistant = computeToolGroups([result("Zsh"), result("Zsh"), assistant(), result("Zsh")]);
    expect(withAssistant.every((i) => i.kind === "entry")).toBe(true);

    const withUser = computeToolGroups([result("Zsh"), result("Zsh"), user(), result("Zsh")]);
    expect(withUser.every((i) => i.kind === "entry")).toBe(true);
  });

  it("does NOT collapse media-bearing tool_results (rich view)", () => {
    const items = computeToolGroups([mediaResult("Image"), mediaResult("Image"), mediaResult("Image")]);
    expect(items.every((i) => i.kind === "entry")).toBe(true);
    expect(items).toHaveLength(3);
  });

  it("collapses a long burst and keeps the latest as the in-full anchor", () => {
    const msgs = Array.from({ length: 25 }, () => result("Zsh"));
    const items = computeToolGroups(msgs);
    expect(items).toHaveLength(1);
    const g = items[0]!;
    if (g.kind === "group") {
      expect(g.members).toHaveLength(25);
      expect(g.latestIndex).toBe(24);
    }
  });
});
