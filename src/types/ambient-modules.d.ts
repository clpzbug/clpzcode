/**
 * Ambient module declarations for packages that are:
 *   - Anthropic-internal (@ant/*) — not published to npm
 *   - Optional dependencies absent from the open-source snapshot
 *   - Native addons (napi) that require platform-specific builds
 *
 * All are typed as `any` to unblock `tsc --noEmit`. If these packages are
 * ever installed, replace the stubs with proper imports or `@types/*` packages.
 * See issue #473.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Anthropic-internal packages
declare module '@ant/claude-for-chrome-mcp' {
  export type ClaudeForChromeContext = any
  export type Logger = any
  export type PermissionMode = any
  export const BROWSER_TOOLS: any
  export const createClaudeForChromeMcpServer: any
  const _default: any; export default _default
}
declare module '@ant/computer-use-input' {
  export type ComputerUseInput = any
  export type ComputerUseInputAPI = any
  const _default: any; export default _default
}
declare module '@ant/computer-use-mcp' {
  export type ComputerExecutor = any
  export type DisplayGeometry = any
  export type FrontmostApp = any
  export type InstalledApp = any
  export type ResolvePrepareCaptureResult = any
  export type RunningApp = any
  export type ScreenshotResult = any
  export type ComputerUseSessionContext = any
  export type CuCallToolResult = any
  export type CuPermissionRequest = any
  export type CuPermissionResponse = any
  export type ScreenshotDims = any
  export const API_RESIZE_PARAMS: any
  export const targetImageSize: any
  export const buildComputerUseTools: any
  export const createComputerUseMcpServer: any
  export const bindSessionContext: any
  export const DEFAULT_GRANT_FLAGS: any
  const _default: any; export default _default
}
declare module '@ant/computer-use-mcp/sentinelApps' {
  export const getSentinelCategory: any
  const _default: any; export default _default
}
declare module '@ant/computer-use-mcp/types' {
  export type CuPermissionRequest = any
  export type CuPermissionResponse = any
  export type CoordinateMode = any
  export type CuSubGates = any
  export type ComputerUseHostAdapter = any
  export type Logger = any
  export const DEFAULT_GRANT_FLAGS: any
  const _default: any; export default _default
}
declare module '@ant/computer-use-swift' {
  export type ComputerUseAPI = any
  const _default: any; export default _default
}
declare module '@anthropic-ai/claude-agent-sdk' {
  export type PermissionMode = any
  const _default: any; export default _default
}
declare module '@anthropic-ai/mcpb' {
  export type McpbManifest = any
  export type McpbUserConfigurationOption = any
  const _default: any; export default _default
}

// External packages absent from open snapshot
declare module 'asciichart' {
  export const plot: any
  const _default: any; export default _default
}
declare module 'audio-capture-napi' { const m: any; export = m; export default m }
declare module '@aws-sdk/client-bedrock' { const m: any; export = m; export default m }
declare module '@aws-sdk/client-sts' { const m: any; export = m; export default m }
declare module 'cacache' { const m: any; export = m; export default m }
declare module 'image-processor-napi' { const m: any; export = m; export default m }
declare module 'plist' { const m: any; export = m; export default m }
declare module 'url-handler-napi' { const m: any; export = m; export default m }
declare module 'vitest' {
  export const describe: any
  export const test: any
  export const it: any
  export const expect: any
  export const vi: any
  export const beforeEach: any
  export const afterEach: any
  export const beforeAll: any
  export const afterAll: any
  const _default: any; export default _default
}

// Markdown files imported as raw string content (bundler handles at build time)
declare module '*.md' { const content: string; export default content }

// Bun test module cache-busting: dynamic imports with query strings
// e.g. import('./module.js?cache-key')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module '*.js?*' { const m: any; export = m; export default m }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module '*.ts?*' { const m: any; export = m; export default m }
