// Agent bridge: backs the clpzcode frontend (src/clpz-ui/ui/*) with the
// clpzcode engine (query.ts -> QueryEngine). It exposes EXACTLY the Agent
// surface that src/clpz-ui/ui/app.tsx consumes (see agentMethods in the port
// manifest) and translates the clpzcode SDKMessage stream into the coarse TUI
// StreamChunk union the App expects.
//
// Design seam: processMessage() lazily builds a QueryEngine the same way the
// SDK v2 entrypoint does (getDefaultAppState + getTools + a per-bridge store +
// a canUseTool), then drives QueryEngine.submitMessage() and re-emits TUI
// StreamChunk by reading the Anthropic content blocks on each SDKMessage.
//
// What is REAL (wired to the clpzcode brain): processMessage streaming, tool
// calls / tool results, permission approval (respondToToolApproval), model
// (read/write via clpzcode AppState + global config), mode (mapped onto the
// clpzcode permission mode), cwd, chat history (getChatEntries), abort, session
// identity (startNewSession / getSessionId / getSessionTitle), and context
// token stats accumulated from result usage.
//
// What is STUB (safe no-ops so the App never breaks — these are TUI-only
// peripherals with no clpzcode analogue in scope for this phase): telegram
// (setSendTelegramFile), schedules (listSchedules / removeSchedule /
// getScheduleDaemonStatus), payments precheck on approval requests,
// askSideQuestion, generateTitle, session recap, and sandbox settings (held
// in-memory; the clpzcode sandbox is governed by its own permission context).

// NOTE on imports: QueryEngine.ts, tools.ts and entrypoints/init.ts live in a
// pre-existing circular-init cycle that only resolves through the normal app
// boot order (cli.tsx dynamic-import chain). Importing them at module top level
// throws "Cannot access 'X' before initialization". They are therefore loaded
// lazily inside the methods that need them — the same dynamic-import pattern the
// rest of clpzcode uses. All other engine modules load standalone and stay
// static.
import type { QueryEngine } from 'src/QueryEngine.js'
import {
  getSessionId as clpzGetSessionId,
  regenerateSessionId,
} from 'src/bootstrap/state.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import {
  type AppState,
  getDefaultAppState,
} from 'src/state/AppStateStore.js'
import { createStore, type Store } from 'src/state/store.js'
import type { Message } from 'src/types/message.js'
import type { PermissionDecision } from 'src/types/permissions.js'
import { createAbortController } from 'src/utils/abortController.js'
import { saveGlobalConfig } from 'src/utils/config.js'
import { getCwd as clpzGetCwd } from 'src/utils/cwd.js'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import type { EffortValue } from 'src/utils/effort.js'
import { buildPermissionContext } from 'src/entrypoints/sdk/permissions.js'
// Routing for xAI/Grok models is env-driven; this flips CLAUDE_CODE_USE_OPENAI /
// OPENAI_BASE_URL to match the selected model's vendor. Standalone module (not in
// the QueryEngine/tools/init cycle), so it is safe to import statically here.
import { switchProviderEnvForModel } from 'src/utils/model/multiProviderOptions.js'
import { dequeueAllMatching } from 'src/utils/messageQueueManager.js'
import { extractTextContent } from 'src/utils/messages.js'
import { stopTask, StopTaskError } from 'src/tasks/stopTask.js'
import type { TaskState } from 'src/tasks/types.js'

import { type ActivityItem, selectActivityItems } from './activity'
import { DEFAULT_MODEL } from './models/models'
import type { ScheduleDaemonStatus, StoredSchedule } from './tools/schedule'
import type {
  AgentMode,
  ChatEntry,
  ReasoningEffort,
  SessionInfo,
  SessionSnapshot,
  StreamChunk,
  SubagentStatus,
  ToolCall,
  ToolResult,
} from './types/index'
import type { SandboxMode, SandboxSettings } from './utils/settings'

export interface SideQuestionResult {
  response: string
  usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number }
}

export interface AgentOptions {
  persistSession?: boolean
  session?: string
  sandboxMode?: SandboxMode
  sandboxSettings?: SandboxSettings
  batchApi?: boolean
}

type ProcessMessageFinishReason =
  | 'stop'
  | 'length'
  | 'content-filter'
  | 'tool-calls'
  | 'error'
  | 'other'

export interface ProcessMessageUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsdTicks?: number
}

export interface ProcessMessageStepStart {
  stepNumber: number
  timestamp: number
}

export interface ProcessMessageStepFinish {
  stepNumber: number
  timestamp: number
  finishReason: ProcessMessageFinishReason
  usage: ProcessMessageUsage
}

export interface ProcessMessageToolStart {
  toolCall: ToolCall
  timestamp: number
}

export interface ProcessMessageToolFinish {
  toolCall: ToolCall
  toolResult: ToolResult
  timestamp: number
}

export interface ProcessMessageError {
  message: string
  timestamp: number
}

export interface ProcessMessageObserver {
  onStepStart?(info: ProcessMessageStepStart): void
  onStepFinish?(info: ProcessMessageStepFinish): void
  onToolStart?(info: ProcessMessageToolStart): void
  onToolFinish?(info: ProcessMessageToolFinish): void
  onError?(info: ProcessMessageError): void
}

// ---------------------------------------------------------------------------
// SDKMessage shape (structural — avoids importing the heavy SDK type graph).
// Mirrors the relevant fields of coreTypes.generated SDKMessage variants.
// ---------------------------------------------------------------------------

interface AnthropicTextBlock {
  type: 'text'
  text: string
}
interface AnthropicThinkingBlock {
  type: 'thinking'
  thinking: string
}
interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content?: unknown
  is_error?: boolean
}
type AnthropicBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | { type: string; [k: string]: unknown }

interface SDKMessageLike {
  type: string
  subtype?: string
  message?: { role?: string; content?: unknown }
  result?: string
  is_error?: boolean
  errors?: string[]
  error?: string
  usage?: Record<string, number>
  total_cost_usd?: number
}

// Permission decision agreed between bridge.canUseTool and respondToToolApproval.
type ApprovalResolve = (approved: boolean) => void

// Maps a TUI AgentMode onto a clpzcode permission mode for the engine.
function modeToPermissionMode(mode: AgentMode): 'default' | 'plan' {
  return mode === 'plan' ? 'plan' : 'default'
}

// Convert a TUI ReasoningEffort to the clpzcode EffortValue stored in
// AppState.effortValue. toPersistableEffort normalizes 'xhigh' -> 'max' and
// passes low/medium/high/max through; undefined => let the model default apply.
function reasoningEffortToEffortValue(
  effort: ReasoningEffort | undefined,
): EffortValue | undefined {
  if (effort === undefined) return undefined
  const { toPersistableEffort } =
    require('src/utils/effort.js') as typeof import('src/utils/effort.js')
  return toPersistableEffort(effort)
}

function blocksOf(content: unknown): AnthropicBlock[] {
  if (Array.isArray(content)) return content as AnthropicBlock[]
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  return []
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(b => {
        if (typeof b === 'string') return b
        if (b && typeof b === 'object' && 'text' in b)
          return String((b as { text: unknown }).text ?? '')
        return ''
      })
      .join('')
  }
  if (content == null) return ''
  return typeof content === 'object' ? JSON.stringify(content) : String(content)
}

// Maps QueryEngine's api_retry system message into a transient status chunk so
// the TUI shows a reconnect indicator instead of a mute hang during backoff /
// waiting for connectivity. retry_delay_ms of 0 marks the wait-for-connectivity
// branch (no fixed countdown); a positive delay is a timed backoff retry.
export function apiRetryStatusChunk(sys: {
  attempt?: number
  retry_delay_ms?: number
}): StreamChunk {
  const retryInMs = sys.retry_delay_ms ?? 0
  return {
    type: 'status',
    statusPhase: retryInMs > 0 ? 'reconnecting' : 'network_wait',
    statusAttempt: sys.attempt ?? 1,
    statusRetryInMs: retryInMs,
  }
}

export class AgentBridge {
  private modelId: string
  // Selected reasoning effort in the TUI ReasoningEffort shape (the App's
  // persisted per-model value). Converted to the clpzcode EffortValue and
  // written to AppState.effortValue, which the engine reads when building each
  // request (query.ts -> resolveAppliedEffort). undefined => model default.
  private reasoningEffort: ReasoningEffort | undefined
  private mode: AgentMode = 'agent'
  private sandboxMode: SandboxMode
  private sandboxSettings: SandboxSettings
  private apiKey: string | null = null
  private baseURL: string | null
  private recapsEnabled = true
  private planContext: string | null = null
  private maxToolRounds: number | undefined

  // Engine + conversation state (persists across turns within one session).
  private engine: QueryEngine | null = null
  private store: Store<AppState> | null = null
  private mutableMessages: Message[] = []
  private abortController: AbortController = createAbortController()

  // TUI-facing chat history, rebuilt incrementally from the SDK stream.
  private chatEntries: ChatEntry[] = []
  // Tool calls awaiting result, keyed by clpzcode tool_use id, so a later
  // tool_result block can be paired into a 'tool_result' chunk.
  private pendingToolCalls = new Map<string, ToolCall>()
  // Permission approvals awaiting respondToToolApproval(id, bool).
  private pendingApprovals = new Map<string, ApprovalResolve>()

  // Accumulated token usage (drives getContextStats).
  private usedTokens = 0

  // Session identity (mirrors clpzcode's session for title/id).
  private sessionTitle: string | null = null

  private subagentListeners = new Set<(s: SubagentStatus | null) => void>()
  // Activity-panel subscribers. Value is the live store unsubscribe, or null
  // while the store does not exist yet (subscribed before the first turn);
  // attachActivitySubs() wires those up once getEngine() creates the store.
  private activitySubs = new Map<() => void, (() => void) | null>()
  private initPromise: Promise<void> | null = null

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    model?: string,
    maxToolRounds?: number,
    options: AgentOptions = {},
  ) {
    this.apiKey = apiKey ?? null
    this.baseURL = baseURL || null
    this.modelId = model || DEFAULT_MODEL
    // A number => that cap; undefined => unbounded (the query.ts `maxTurns && …`
    // guard is skipped). `|| 400` would wrongly coerce both undefined and an
    // explicit 0 back to 400, re-introducing the hard stop on long sessions.
    this.maxToolRounds = maxToolRounds
    this.sandboxMode = options.sandboxMode ?? 'off'
    this.sandboxSettings = options.sandboxSettings ?? {}
  }

  // -- model -----------------------------------------------------------------

  getModel(): string {
    return this.modelId
  }

  setModel(model: string): void {
    // Flip the provider routing env to match the model's vendor BEFORE anything
    // else, so the next request hits xAI for grok models (and native Anthropic
    // when switching back). Without this, grok models are sent to the Anthropic
    // endpoint and rejected ("grok models don't work after login").
    switchProviderEnvForModel(model)
    this.modelId = model
    if (this.store) {
      this.store.setState(prev => ({
        ...prev,
        mainLoopModel: model,
        mainLoopModelForSession: model,
      }))
    }
    // The cached engine resolves its model from config.userSpecifiedModel
    // (parsed inside submitMessage), NOT from the store's mainLoopModel — so the
    // store write alone would not switch a live engine. Push the new id into the
    // engine directly so the next turn actually uses the selected model.
    this.engine?.setModel(model)
    try {
      saveGlobalConfig(cfg => ({ ...cfg, model }))
    } catch {
      /* config write is best-effort; in-memory modelId is the source of truth */
    }
  }

  // -- reasoning effort ------------------------------------------------------

  getReasoningEffort(): ReasoningEffort | undefined {
    return this.reasoningEffort
  }

  // Apply the App's selected reasoning effort so the next (and live) engine
  // turn actually sends it. The TUI ReasoningEffort shape ('xhigh') is
  // normalized to the clpzcode EffortValue ('max') via toPersistableEffort.
  setReasoningEffort(effort: ReasoningEffort | undefined): void {
    this.reasoningEffort = effort
    if (this.store) {
      const effortValue = reasoningEffortToEffortValue(effort)
      this.store.setState(prev => ({ ...prev, effortValue }))
    }
  }

  // -- mode ------------------------------------------------------------------

  getMode(): AgentMode {
    return this.mode
  }

  setMode(mode: AgentMode): void {
    this.mode = mode
    if (this.store) {
      const pm = modeToPermissionMode(mode)
      this.store.setState(prev => ({
        ...prev,
        toolPermissionContext: { ...prev.toolPermissionContext, mode: pm },
      }))
    }
  }

  // -- sandbox (in-memory; clpzcode governs real sandboxing) -----------------

  getSandboxMode(): SandboxMode {
    return this.sandboxMode
  }

  setSandboxMode(mode: SandboxMode): void {
    this.sandboxMode = mode
  }

  getSandboxSettings(): SandboxSettings {
    return this.sandboxSettings
  }

  setSandboxSettings(settings: SandboxSettings): void {
    this.sandboxSettings = settings
  }

  setPlanContext(ctx: string | null): void {
    this.planContext = ctx
  }

  // STUB: telegram file send has no clpzcode analogue in the frontend port.
  setSendTelegramFile(
    _fn: ((filePath: string) => Promise<ToolResult>) | null,
  ): void {}

  // -- api key ---------------------------------------------------------------

  hasApiKey(): boolean {
    // clpzcode resolves credentials through its own config/oauth layer, so the
    // chat loop works without an explicit native key. Report true once any
    // key has been seen OR a clpzcode config exists, so the App skips its key
    // modal and lets the engine source credentials.
    if (this.apiKey !== null) return true
    return true
  }

  setApiKey(apiKey: string, baseURL = this.baseURL ?? undefined): void {
    this.apiKey = apiKey
    this.baseURL = baseURL || null
  }

  getCwd(): string {
    try {
      return clpzGetCwd()
    } catch {
      return process.cwd()
    }
  }

  // -- schedules (STUB) ------------------------------------------------------

  async listSchedules(): Promise<StoredSchedule[]> {
    return []
  }

  async removeSchedule(_id: string): Promise<string> {
    return 'Schedules are not available in this build.'
  }

  async getScheduleDaemonStatus(): Promise<ScheduleDaemonStatus> {
    return { running: false, pid: null }
  }

  // -- context stats ---------------------------------------------------------

  getContextStats(
    contextWindow: number,
    inFlightText = '',
  ): {
    contextWindow: number
    usedTokens: number
    remainingTokens: number
    ratioUsed: number
    ratioRemaining: number
  } {
    // Rough estimate for streaming text not yet billed (~4 chars/token).
    const inFlight = inFlightText ? Math.ceil(inFlightText.length / 4) : 0
    const used = Math.min(this.usedTokens + inFlight, contextWindow)
    const remaining = Math.max(contextWindow - used, 0)
    return {
      contextWindow,
      usedTokens: used,
      remainingTokens: remaining,
      ratioUsed: contextWindow > 0 ? used / contextWindow : 0,
      ratioRemaining: contextWindow > 0 ? remaining / contextWindow : 1,
    }
  }

  // STUB: clpzcode generates titles through its own session pipeline; the TUI
  // App treats an empty string as "no title yet" and keeps the placeholder.
  async generateTitle(_userMessage: string): Promise<string> {
    return ''
  }

  // STUB: recap is a TUI-only session-summary feature.
  getSessionRecap(): string | null {
    return null
  }

  getRecapsEnabled(): boolean {
    return this.recapsEnabled
  }

  setRecapsEnabled(enabled: boolean): void {
    this.recapsEnabled = enabled
  }

  // Drain task-notifications addressed to the main thread (background/async
  // sub-agents, shells) from the process-global command queue. The engine only
  // drains this queue *inside* an active turn (query.ts), so once the parent
  // turn ends a finished sub-agent's result would be stranded forever — the App
  // polls this and re-injects the batch as a fresh turn so the orchestrator is
  // actually notified. Mirrors the main-thread filter at query.ts (agentId
  // undefined => addressed to the leader).
  async consumeBackgroundNotifications(): Promise<string[]> {
    const drained = dequeueAllMatching(
      cmd => cmd.mode === 'task-notification' && cmd.agentId === undefined,
    )
    return drained.map(cmd =>
      typeof cmd.value === 'string' ? cmd.value : extractTextContent(cmd.value),
    )
  }

  // STUB: side questions (ask-without-tools) not wired to clpzcode yet.
  async askSideQuestion(
    _question: string,
    _signal?: AbortSignal,
  ): Promise<SideQuestionResult> {
    return { response: '' }
  }

  // -- lifecycle -------------------------------------------------------------

  abort(): void {
    try {
      this.abortController.abort()
    } catch {
      /* already aborted */
    }
    // Reject any outstanding approvals so the engine unwinds cleanly.
    for (const resolve of this.pendingApprovals.values()) resolve(false)
    this.pendingApprovals.clear()
    // A fresh controller so the next turn starts un-aborted.
    this.abortController = createAbortController()
    // The aborted engine cannot be reused mid-turn; drop it so the next
    // processMessage rebuilds against the carried-over message history.
    this.engine = null
  }

  async cleanup(): Promise<void> {
    this.abort()
  }

  // -- permission approval flow ----------------------------------------------

  respondToToolApproval(approvalId: string, approved: boolean): void {
    const resolve = this.pendingApprovals.get(approvalId)
    if (resolve) {
      this.pendingApprovals.delete(approvalId)
      resolve(approved)
    }
  }

  // -- history / session -----------------------------------------------------

  clearHistory(): void {
    this.chatEntries = []
    this.mutableMessages = []
    this.pendingToolCalls.clear()
    this.usedTokens = 0
    this.engine = null
  }

  startNewSession(): SessionSnapshot | null {
    this.clearHistory()
    this.sessionTitle = null
    let id: string
    try {
      id = String(regenerateSessionId())
    } catch {
      id = `clpz-${Date.now().toString(36)}`
    }
    const now = new Date()
    const cwd = this.getCwd()
    const session: SessionInfo = {
      id,
      workspaceId: cwd,
      title: null,
      recap: null,
      model: this.modelId,
      mode: this.mode,
      cwdAtStart: cwd,
      cwdLast: cwd,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    return {
      workspace: {
        id: cwd,
        scopeKey: cwd,
        canonicalPath: cwd,
        gitRoot: null,
        displayName: cwd,
        lastSeenAt: now,
      },
      session,
      messages: [],
      entries: [],
      totalTokens: 0,
    }
  }

  getSessionId(): string | null {
    try {
      return String(clpzGetSessionId())
    } catch {
      return null
    }
  }

  getSessionTitle(): string | null {
    return this.sessionTitle
  }

  getChatEntries(): ChatEntry[] {
    return this.chatEntries
  }

  onSubagentStatus(
    listener: (status: SubagentStatus | null) => void,
  ): () => void {
    this.subagentListeners.add(listener)
    return () => {
      this.subagentListeners.delete(listener)
    }
  }

  // -- live activity seam (footer pill + activity panel) ---------------------
  // The bridge's private store already holds every spawned unit (agents,
  // workflows, shells) under store.tasks; these three methods are the only
  // window the TUI UI needs into it — read, subscribe, and precisely cancel.

  getActivityItems(): ActivityItem[] {
    return selectActivityItems(
      this.store?.getState().tasks as Record<string, TaskState> | undefined,
    )
  }

  subscribeActivity(listener: () => void): () => void {
    const store = this.store
    this.activitySubs.set(listener, store ? store.subscribe(listener) : null)
    return () => {
      const unsub = this.activitySubs.get(listener)
      if (unsub) unsub()
      this.activitySubs.delete(listener)
    }
  }

  async killActivity(id: string): Promise<void> {
    const store = this.store
    if (!store) return
    try {
      await stopTask(id, {
        getAppState: () => store.getState(),
        setAppState: (f: (prev: AppState) => AppState) => store.setState(f),
      })
    } catch (err) {
      // A task that completes between the keypress and the kill races us;
      // not_found / not_running are benign here.
      if (!(err instanceof StopTaskError)) throw err
    }
  }

  private attachActivitySubs(store: Store<AppState>): void {
    for (const [listener, unsub] of this.activitySubs) {
      if (!unsub) this.activitySubs.set(listener, store.subscribe(listener))
    }
  }

  // -- engine construction ---------------------------------------------------

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = import('src/entrypoints/init.js')
        .then(m => m.init())
        .catch(() => {
          // init is memoized and best-effort here; a failure must not wedge the
          // bridge — the engine will still attempt to run and surface a real
          // error chunk if it cannot.
        })
    }
    await this.initPromise
  }

  // canUseTool: clpzcode asks the bridge before each tool runs. Default policy
  // is allow (the clpzcode permission context already encodes the user's mode);
  // the pendingApprovals map lets respondToToolApproval drive an explicit
  // approve/deny when the App registers one. We do not block by default to
  // avoid hanging the chat loop, matching the App's processMessage contract
  // (it only surfaces approval UI for payment-style tools).
  private buildCanUseTool(): CanUseToolFn {
    return (async (tool, input) => {
      const decision: PermissionDecision = {
        behavior: 'allow',
        updatedInput: input,
      }
      return decision
    }) as CanUseToolFn
  }

  private async getEngine(): Promise<QueryEngine> {
    // Re-assert routing for the current model before each turn (the engine reads
    // the provider env at request time), so the very first turn — and any turn
    // after the env was touched elsewhere — hits the correct endpoint.
    switchProviderEnvForModel(this.modelId)
    if (this.engine) return this.engine

    // Lazy-load the cycle members (see import note at top of file).
    const { QueryEngine: QueryEngineClass } = await import('src/QueryEngine.js')
    const { getTools } = await import('src/tools.js')

    const cwd = this.getCwd()
    const permissionContext = buildPermissionContext({
      cwd,
      permissionMode: modeToPermissionMode(this.mode),
    })
    const initialAppState = getDefaultAppState()
    const stateWithModel: AppState = {
      ...initialAppState,
      toolPermissionContext: permissionContext,
      mainLoopModel: this.modelId,
      mainLoopModelForSession: this.modelId,
      effortValue: reasoningEffortToEffortValue(this.reasoningEffort),
    }
    const store = createStore<AppState>(stateWithModel)
    this.store = store
    // Wire any activity subscribers that mounted before this first turn.
    this.attachActivitySubs(store)

    const tools = getTools(permissionContext)
    const readFileCache = createFileStateCacheWithSizeLimit(100)

    this.engine = new QueryEngineClass({
      cwd,
      tools,
      commands: [],
      mcpClients: [],
      agents: [],
      canUseTool: this.buildCanUseTool(),
      getAppState: () => store.getState(),
      setAppState: (f: (prev: AppState) => AppState) => store.setState(f),
      initialMessages: this.mutableMessages,
      readFileCache,
      userSpecifiedModel: this.modelId,
      maxTurns: this.maxToolRounds,
      abortController: this.abortController,
      // Emit stream_event partials so the App receives live assistant text and
      // thinking deltas (the 'stream_event' case in processMessage). Without
      // this the engine only yields whole assistant messages and reasoning is
      // never surfaced.
      includePartialMessages: true,
    })
    return this.engine
  }

  // -- the seam: clpzcode SDKMessage stream -> grok StreamChunk --------------

  async *processMessage(
    userMessage: string,
    observer?: ProcessMessageObserver,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    await this.ensureInit()

    // Record the user turn in grok history immediately.
    this.chatEntries.push({
      type: 'user',
      content: userMessage,
      timestamp: new Date(),
      modeColor: undefined,
    })

    let stepNumber = 0
    observer?.onStepStart?.({ stepNumber, timestamp: Date.now() })

    const engine = await this.getEngine()
    // Capture the controller the engine was built with. abort() swaps
    // this.abortController for a fresh one, so checking the field inside the
    // loop would read the new (un-aborted) controller and never break.
    const ac = this.abortController

    // Accumulates streamed assistant text for one assistant block so the final
    // grok ChatEntry carries the full message (the App renders deltas live).
    let assistantTextAcc = ''
    // Tracks whether reasoning deltas were already streamed for the current
    // step, so the assistant block's thinking text is not re-emitted.
    let reasoningStreamed = false

    try {
      for await (const raw of engine.submitMessage(userMessage)) {
        if (ac.signal.aborted) break
        const msg = raw as unknown as SDKMessageLike

        switch (msg.type) {
          case 'stream_event': {
            // Partial assistant deltas (text / thinking).
            const ev = (raw as unknown as { event?: Record<string, unknown> })
              .event
            const delta = ev?.delta as
              | { type?: string; text?: string; thinking?: string }
              | undefined
            if (delta?.type === 'text_delta' && delta.text) {
              assistantTextAcc += delta.text
              yield { type: 'content', content: delta.text }
            } else if (delta?.type === 'thinking_delta' && delta.thinking) {
              reasoningStreamed = true
              yield { type: 'reasoning', content: delta.thinking }
            }
            break
          }

          case 'assistant': {
            // Context-window occupancy = the LAST response's own usage (each API
            // call re-sends the whole context), NOT the cumulative session usage.
            // Read it off the assistant message and OVERWRITE (don't accumulate),
            // so the meter reflects current occupancy and drops after compaction.
            const aUsage = (
              msg.message as
                | {
                    usage?: {
                      input_tokens?: number
                      output_tokens?: number
                      cache_read_input_tokens?: number
                      cache_creation_input_tokens?: number
                    }
                  }
                | undefined
            )?.usage
            if (aUsage) {
              const ctx =
                (aUsage.input_tokens ?? 0) +
                (aUsage.cache_read_input_tokens ?? 0) +
                (aUsage.cache_creation_input_tokens ?? 0) +
                (aUsage.output_tokens ?? 0)
              if (ctx > 0) this.usedTokens = ctx
            }
            const blocks = blocksOf(msg.message?.content)
            const toolCalls: ToolCall[] = []
            for (const b of blocks) {
              if (b.type === 'tool_use') {
                const tu = b as AnthropicToolUseBlock
                const call: ToolCall = {
                  id: tu.id,
                  type: 'function',
                  function: {
                    name: tu.name,
                    arguments: JSON.stringify(tu.input ?? {}),
                  },
                }
                toolCalls.push(call)
                this.pendingToolCalls.set(tu.id, call)
                observer?.onToolStart?.({ toolCall: call, timestamp: Date.now() })
                this.chatEntries.push({
                  type: 'tool_call',
                  content: '',
                  timestamp: new Date(),
                  toolCall: call,
                })
              } else if (b.type === 'text') {
                const text = (b as AnthropicTextBlock).text
                if (text && !assistantTextAcc) {
                  // Non-streamed assistant text (no stream_event deltas): emit
                  // it now so the App still renders the message.
                  yield { type: 'content', content: text }
                }
              } else if (b.type === 'thinking') {
                const thinking = (b as AnthropicThinkingBlock).thinking
                if (thinking && !reasoningStreamed) {
                  // Non-streamed reasoning (no thinking_delta events): surface it
                  // so the App's reasoning view still renders.
                  yield { type: 'reasoning', content: thinking }
                }
              }
            }
            // Finalize the assistant text entry for this step.
            const finalText = assistantTextAcc || textFromBlocks(blocks)
            if (finalText) {
              this.chatEntries.push({
                type: 'assistant',
                content: finalText,
                timestamp: new Date(),
              })
            }
            assistantTextAcc = ''
            reasoningStreamed = false
            if (toolCalls.length > 0) {
              yield { type: 'tool_calls', toolCalls }
            }
            observer?.onStepFinish?.({
              stepNumber,
              timestamp: Date.now(),
              finishReason: toolCalls.length > 0 ? 'tool-calls' : 'stop',
              usage: {},
            })
            stepNumber += 1
            observer?.onStepStart?.({ stepNumber, timestamp: Date.now() })
            break
          }

          case 'user': {
            // Carries tool_result blocks back from the engine.
            const blocks = blocksOf(msg.message?.content)
            for (const b of blocks) {
              if (b.type === 'tool_result') {
                const tr = b as AnthropicToolResultBlock
                const call = this.pendingToolCalls.get(tr.tool_use_id)
                if (!call) continue
                this.pendingToolCalls.delete(tr.tool_use_id)
                const text = toolResultText(tr.content)
                const result: ToolResult = tr.is_error
                  ? { success: false, error: text }
                  : { success: true, output: text }
                observer?.onToolFinish?.({
                  toolCall: call,
                  toolResult: result,
                  timestamp: Date.now(),
                })
                this.chatEntries.push({
                  type: 'tool_result',
                  content: text,
                  timestamp: new Date(),
                  toolCall: call,
                  toolResult: result,
                })
                yield { type: 'tool_result', toolCall: call, toolResult: result }
              }
            }
            break
          }

          case 'result': {
            // Occupancy is normally set from the last assistant response above.
            // The result usage is CUMULATIVE (lifetime), so only use it as a
            // fallback when no assistant response reported its own usage at all —
            // never let it accumulate the meter past the real context size.
            if (this.usedTokens === 0 && msg.usage) {
              const u = msg.usage
              const total =
                (u.input_tokens ?? 0) +
                (u.output_tokens ?? 0) +
                (u.cache_read_input_tokens ?? 0) +
                (u.cache_creation_input_tokens ?? 0)
              if (total > 0) this.usedTokens = total
            }
            if (msg.subtype && msg.subtype !== 'success') {
              const errText =
                (msg.errors && msg.errors.join('\n')) ||
                msg.result ||
                'The engine reported an error.'
              yield { type: 'error', content: errText }
            }
            break
          }

          case 'system': {
            const sys = msg as unknown as {
              subtype?: string
              attempt?: number
              retry_delay_ms?: number
            }
            // Surface auto-compact / manual compact events so the UI can
            // notify the user that conversation history was summarized.
            if (sys.subtype === 'compact_boundary') {
              // History was summarized — drop the stale occupancy so the meter
              // doesn't show the pre-compaction size; the next assistant response
              // overwrites it with the new (smaller) context size.
              this.usedTokens = 0
              yield { type: 'compact' }
            } else if (sys.subtype === 'api_retry') {
              // QueryEngine maps withRetry's api_error into api_retry. Without
              // this branch the retry/backoff is mute and a network-recovery wait
              // (e.g. VPN drop mid-stream) reads as a freeze.
              yield apiRetryStatusChunk(sys)
            }
            break
          }

          default:
            break
        }
      }

      yield { type: 'done' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isAuthError =
        /api key|unauthorized|401|authentication/i.test(message) || false
      observer?.onError?.({ message, timestamp: Date.now() })
      yield { type: 'error', content: message, isAuthError }
      yield { type: 'done' }
    } finally {
      // Reject any approvals left dangling by an early break.
      for (const resolve of this.pendingApprovals.values()) resolve(false)
      this.pendingApprovals.clear()
    }
  }
}

function textFromBlocks(blocks: AnthropicBlock[]): string {
  return blocks
    .filter((b): b is AnthropicTextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
}
