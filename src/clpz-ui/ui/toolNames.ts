// clpzcode's engine emits its canonical PascalCase tool names ("Read"/"Write"/
// "Edit"/"Zsh"…), but this clpzcode UI was written against the TUI's
// snake_case vocabulary ("read_file"/"write_file"/"bash"…). The label/render
// switches all compare against the snake tokens, so without translation every
// file/shell call falls through to the generic row (bare "Zsh"/"Read" with no
// argument). Map canonical → the snake token the UI recognizes; unmapped names
// pass through unchanged so other tools keep their existing generic rendering.
const CANONICAL_TO_CLPZ_UI: Record<string, string> = {
  Zsh: "bash",
  Bash: "bash",
  Read: "read_file",
  Write: "write_file",
  Edit: "edit_file",
  MultiEdit: "edit_file",
  WebSearch: "search_web",
};

export function normalizeToolName(name: string | undefined | null): string {
  if (!name) return "";
  return CANONICAL_TO_CLPZ_UI[name] ?? name;
}
