// Stub — cachedMicrocompact not included in source snapshot (feature-gated)

// Type stubs for internal types used via `import('./cachedMicrocompact.js').TypeName`
export type CachedMCState = {
  registeredTools: Set<string>
  pinnedEdits: PinnedCacheEdits[]
  toolOrder: unknown[]
  deletedRefs: Set<unknown>
  [k: string]: unknown
}
export type CacheEditsBlock = { type: 'cache_edits'; edits: { type: 'delete'; cache_reference: string }[] }
export type PinnedCacheEdits = { userMessageIndex: number; block: CacheEditsBlock }

export function isCachedMicrocompactEnabled(): boolean {
  return false
}

export function isModelSupportedForCacheEditing(_model: string): boolean {
  return false
}

export function getCachedMCConfig(): { triggerThreshold: number; keepRecent: number; supportedModels: string[] } {
  return { triggerThreshold: 50, keepRecent: 5, supportedModels: [] }
}

export function createCachedMCState(..._args: unknown[]): CachedMCState {
  return { registeredTools: new Set(), pinnedEdits: [], toolOrder: [], deletedRefs: new Set() }
}
export function markToolsSentToAPI(..._args: unknown[]): void {}
export function resetCachedMCState(..._args: unknown[]): void {}
export function registerToolResult(..._args: unknown[]): void {}
export function registerToolMessage(..._args: unknown[]): void {}
export function getToolResultsToDelete(..._args: unknown[]): string[] { return [] }
export function createCacheEditsBlock(..._args: unknown[]): CacheEditsBlock { return { type: 'cache_edits', edits: [] } }
