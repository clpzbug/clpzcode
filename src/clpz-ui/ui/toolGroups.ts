import type { ChatEntry } from "../types/index";

// Minimum consecutive same-tool tool_results before they collapse into a group.
export const MIN_GROUP_RUN = 3;

export type RenderItem =
  | { kind: "entry"; entry: ChatEntry; index: number }
  | {
      kind: "group";
      // Stable across the live→finalize message swap and as the run grows: the
      // first member's tool_use id (unique per call, identical in both arrays).
      groupId: string;
      toolName: string;
      members: ChatEntry[]; // every tool_result in the run, in order
      memberIndices: number[]; // their original indices in `messages` (parallel to members)
      latestIndex: number; // memberIndices.at(-1) — the entry always rendered in full
    };

// A tool_result is foldable when it renders as the plain one-line ExpandableTool
// row in MessageView (app.tsx tool_result switch). The only name-agnostic rich
// branch is media (image/video), which must never be folded. Every other rich
// branch is gated on TUI-native tool names ("bash"/"edit_file"/…) that this fork
// never emits — it registers PascalCase names ("Zsh"/"Read"/"Edit"…) — so all
// non-media tool_results fall through to the plain row and are foldable.
function isFoldable(entry: ChatEntry): boolean {
  if (entry.type !== "tool_result") return false;
  if (!entry.toolCall?.id || !entry.toolCall.function.name) return false;
  if ((entry.toolResult?.media?.length ?? 0) > 0) return false;
  return true;
}

// Folds maximal runs of consecutive same-tool foldable tool_results (length >=
// MIN_GROUP_RUN) into one group render-item. Intervening tool_call entries (which
// render to null) are transparent and keep the run walking; assistant/user entries
// are hard boundaries. Original indices are preserved so the existing
// expandedMessages / isLastToolResult / Ctrl+O semantics keep working on the
// entry that each group renders in full.
export function computeToolGroups(messages: ChatEntry[]): RenderItem[] {
  const items: RenderItem[] = [];
  let i = 0;

  while (i < messages.length) {
    const entry = messages[i]!;

    if (!isFoldable(entry)) {
      items.push({ kind: "entry", entry, index: i });
      i++;
      continue;
    }

    const toolName = entry.toolCall!.function.name;
    const members: ChatEntry[] = [];
    const memberIndices: number[] = [];
    let lastConsumed = i; // last index belonging to the run (member or skipped tool_call)
    let j = i;

    while (j < messages.length) {
      const e = messages[j]!;
      if (e.type === "tool_call") {
        lastConsumed = j; // transparent — renders null, keep walking the run
        j++;
        continue;
      }
      if (isFoldable(e) && e.toolCall!.function.name === toolName) {
        members.push(e);
        memberIndices.push(j);
        lastConsumed = j;
        j++;
        continue;
      }
      break; // assistant / user / different tool / rich result => boundary
    }

    if (members.length >= MIN_GROUP_RUN) {
      items.push({
        kind: "group",
        groupId: members[0]!.toolCall!.id,
        toolName,
        members,
        memberIndices,
        latestIndex: memberIndices[memberIndices.length - 1]!,
      });
      i = j;
    } else {
      // Too short to collapse: emit every spanned index (members + any skipped
      // tool_calls) as individual entries, preserving the original render order.
      for (let k = i; k <= lastConsumed; k++) {
        items.push({ kind: "entry", entry: messages[k]!, index: k });
      }
      i = lastConsumed + 1;
    }
  }

  return items;
}
