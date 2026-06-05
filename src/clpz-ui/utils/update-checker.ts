// Scaffold stub for the clpzcode TUI frontend port.
//
// The real update-checker depends on the original install-manager (GitHub release
// polling + script-managed self-update), which does not apply to the clpzcode
// port. app.tsx uses checkForUpdate/runUpdate; both report "no update".

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
}

export interface UpdateRunResult {
  success: boolean;
  output: string;
}

export async function checkForUpdate(_currentVersion: string): Promise<UpdateCheckResult | null> {
  return null;
}

export function runUpdate(currentVersion: string): Promise<UpdateRunResult> {
  return Promise.resolve({ success: true, output: `Already up to date (${currentVersion}).` });
}
