// Scaffold stub for the clpzcode TUI frontend port.
//
// The full verify entrypoint depends on the original verify recipe machinery
// (checkpoint/environment/evidence/recipes/retry). app.tsx only uses
// buildVerifyPrompt(cwd) to seed a /verify turn; this returns a static prompt.

export function buildVerifyPrompt(cwd: string): string {
  return [
    `Verify this project locally (cwd: ${cwd}).`,
    "Detect the project's build/test commands, run them, and report results,",
    "evidence, blockers, and residual risk.",
  ].join("\n");
}
