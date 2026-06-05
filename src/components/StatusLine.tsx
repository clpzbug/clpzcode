import { feature } from 'bun:bundle';
import * as fs from 'fs';
import * as React from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import type { PermissionMode } from 'src/utils/permissions/PermissionMode.js';
import { getIsRemoteMode, getKairosActive, getMainThreadAgentType, getOriginalCwd, getSdkBetas, getSessionId } from '../bootstrap/state.js';
import { DEFAULT_OUTPUT_STYLE_NAME } from '../constants/outputStyles.js';
import { useNotifications } from '../context/notifications.js';
import { getTotalAPIDuration, getTotalCost, getTotalDuration, getTotalInputTokens, getTotalLinesAdded, getTotalLinesRemoved, getTotalOutputTokens } from '../cost-tracker.js';
import { useMainLoopModel } from '../hooks/useMainLoopModel.js';
import { type ReadonlySettings, useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, Text } from '../ink.js';
import { getRawUtilization } from '../services/claudeAiLimits.js';
import type { Message } from '../types/message.js';
import type { StatusLineCommandInput } from '../types/statusLine.js';
import type { VimMode } from '../types/textInputTypes.js';
import { checkHasTrustDialogAccepted } from '../utils/config.js';
import { calculateContextPercentages, getContextWindowForModel } from '../utils/context.js';
import { getCwd } from '../utils/cwd.js';
import { logForDebugging } from '../utils/debug.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { createBaseHookInput, executeStatusLineCommand } from '../utils/hooks.js';
import { getLastAssistantMessage } from '../utils/messages.js';
import { getRuntimeMainLoopModel, type ModelName, renderModelName } from '../utils/model/model.js';
import { getCurrentSessionTitle } from '../utils/sessionStorage.js';
import { doesMostRecentAssistantMessageExceed200k, getCurrentUsage } from '../utils/tokens.js';
import { getCurrentWorktreeSession } from '../utils/worktree.js';
import { subscribeMemoryPressure, type MemoryPressure } from '../utils/memoryGovernor.js';
import { isVimModeEnabled } from './PromptInput/utils.js';
import { role } from '../tui/design/index.js';
import { Row } from '../tui/design/index.js';
import { Glyph } from '../tui/anim/index.js';
import { THINKING, WAITING, SETTLE_SUCCESS } from '../tui/anim/index.js';

// Lido pelo comando de statusline do usuário (campo `system`), NÃO pela UI Zen.
// Preservado literalmente: alimenta buildStatusLineCommandInput.
function getRAMInfo(): { used_pct: number; free_mb: number; total_mb: number } {
  try {
    const data = fs.readFileSync('/proc/meminfo', 'utf8')
    const get = (key: string): number => {
      const m = data.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))
      return m ? parseInt(m[1]!, 10) : 0
    }
    const totalKb = get('MemTotal')
    const freeKb = get('MemAvailable')
    const usedKb = totalKb - freeKb
    return {
      total_mb: Math.round(totalKb / 1024),
      free_mb: Math.round(freeKb / 1024),
      used_pct: totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0,
    }
  } catch {
    return { used_pct: 0, free_mb: 0, total_mb: 0 }
  }
}

export function statusLineShouldDisplay(settings: ReadonlySettings): boolean {
  // Assistant mode: statusline fields (model, permission mode, cwd) reflect the
  // REPL/daemon process, not what the agent child is actually running. Hide it.
  if (feature('KAIROS') && getKairosActive()) return false;
  return settings?.statusLine !== undefined;
}

function buildStatusLineCommandInput(permissionMode: PermissionMode, exceeds200kTokens: boolean, settings: ReadonlySettings, messages: Message[], addedDirs: string[], mainLoopModel: ModelName, vimMode?: VimMode): StatusLineCommandInput {
  const agentType = getMainThreadAgentType();
  const worktreeSession = getCurrentWorktreeSession();
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel,
    exceeds200kTokens
  });
  const outputStyleName = settings?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME;
  const currentUsage = getCurrentUsage(messages);
  const contextWindowSize = getContextWindowForModel(runtimeModel, getSdkBetas());
  const contextPercentages = calculateContextPercentages(currentUsage, contextWindowSize);
  const sessionId = getSessionId();
  const sessionName = getCurrentSessionTitle(sessionId);
  const rawUtil = getRawUtilization();
  const rateLimits: StatusLineCommandInput['rate_limits'] = {
    ...(rawUtil.five_hour && {
      five_hour: {
        used_percentage: rawUtil.five_hour.utilization * 100,
        resets_at: rawUtil.five_hour.resets_at
      }
    }),
    ...(rawUtil.seven_day && {
      seven_day: {
        used_percentage: rawUtil.seven_day.utilization * 100,
        resets_at: rawUtil.seven_day.resets_at
      }
    })
  };
  return {
    ...createBaseHookInput(),
    ...(sessionName && {
      session_name: sessionName
    }),
    model: {
      id: runtimeModel,
      display_name: renderModelName(runtimeModel)
    },
    workspace: {
      current_dir: getCwd(),
      project_dir: getOriginalCwd(),
      added_dirs: addedDirs
    },
    version: MACRO.VERSION,
    output_style: {
      name: outputStyleName
    },
    cost: {
      total_cost_usd: getTotalCost(),
      total_duration_ms: getTotalDuration(),
      total_api_duration_ms: getTotalAPIDuration(),
      total_lines_added: getTotalLinesAdded(),
      total_lines_removed: getTotalLinesRemoved()
    },
    context_window: {
      total_input_tokens: getTotalInputTokens(),
      total_output_tokens: getTotalOutputTokens(),
      context_window_size: contextWindowSize,
      current_usage: currentUsage,
      used_percentage: contextPercentages.used,
      remaining_percentage: contextPercentages.remaining
    },
    exceeds_200k_tokens: exceeds200kTokens,
    ...((rateLimits.five_hour || rateLimits.seven_day) && {
      rate_limits: rateLimits
    }),
    ...(isVimModeEnabled() && {
      vim: {
        mode: vimMode ?? 'INSERT'
      }
    }),
    ...(agentType && {
      agent: {
        name: agentType
      }
    }),
    ...(getIsRemoteMode() && {
      remote: {
        session_id: getSessionId()
      }
    }),
    ...(worktreeSession && {
      worktree: {
        name: worktreeSession.worktreeName,
        path: worktreeSession.worktreePath,
        branch: worktreeSession.worktreeBranch,
        original_cwd: worktreeSession.originalCwd,
        original_branch: worktreeSession.originalBranch
      }
    }),
    system: getRAMInfo(),
  };
}

type Props = {
  // messages stays behind a ref (read only in the debounced callback);
  // lastAssistantMessageId is the actual re-render trigger.
  messagesRef: React.RefObject<Message[]>;
  lastAssistantMessageId: string | null;
  vimMode?: VimMode;
};

export function getLastAssistantMessageId(messages: Message[]): string | null {
  return getLastAssistantMessage(messages)?.uuid ?? null;
}

function StatusLineInner({
  messagesRef,
  lastAssistantMessageId,
  vimMode
}: Props): React.ReactNode {
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const additionalWorkingDirectories = useAppState(s => s.toolPermissionContext.additionalWorkingDirectories);
  const statusLineText = useAppState(s => s.statusLineText);
  const currentGoal = useAppState(s => s.currentGoal);
  const goalSetAt = useAppState(s => s.goalSetAt);
  const goalIsLoading = useAppState(s => s.goalIsLoading);
  const goalCompletedAt = useAppState(s => s.goalCompletedAt);
  const spinnerTip = useAppState(s => s.spinnerTip);
  const setAppState = useSetAppState();
  const settings = useSettings();
  const networkRecovering = useAppState(s => s.networkRecovering)
  const {
    addNotification
  } = useNotifications();
  // AppState-sourced model — same source as API requests. getMainLoopModel()
  // re-reads settings.json on every call, so another session's /model write
  // would leak into this session's statusline (anthropics/claude-code#37596).
  const mainLoopModel = useMainLoopModel();

  // Keep latest values in refs for stable callback access
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const vimModeRef = useRef(vimMode);
  vimModeRef.current = vimMode;
  const permissionModeRef = useRef(permissionMode);
  permissionModeRef.current = permissionMode;
  const addedDirsRef = useRef(additionalWorkingDirectories);
  addedDirsRef.current = additionalWorkingDirectories;
  const mainLoopModelRef = useRef(mainLoopModel);
  mainLoopModelRef.current = mainLoopModel;

  // Heap pressure from the memory governor — the OOM-relevant signal (heapUsed
  // vs the V8 ceiling). Driven by the governor's own sampling interval, no extra
  // timer here. Zen: aparece SÓ quando pressure !== 'normal'.
  const [heap, setHeap] = useState<{ pct: number; pressure: MemoryPressure } | null>(null)
  useEffect(() => {
    return subscribeMemoryPressure(s => {
      if (s.heapLimit <= 0) return
      const next = s.pressure === 'normal' ? null : { pct: Math.round(s.ratio * 100), pressure: s.pressure }
      setHeap(prev => {
        if (prev === next) return prev
        if (prev && next && prev.pct === next.pct && prev.pressure === next.pressure) return prev
        return next
      })
    })
  }, [])

  // Track previous state to detect changes and cache expensive calculations
  const previousStateRef = useRef<{
    messageId: string | null;
    exceeds200kTokens: boolean;
    permissionMode: PermissionMode;
    vimMode: VimMode | undefined;
    mainLoopModel: ModelName;
  }>({
    messageId: null,
    exceeds200kTokens: false,
    permissionMode,
    vimMode,
    mainLoopModel
  });

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // True when the next invocation should log its result (first run or after settings reload)
  const logNextResultRef = useRef(true);

  // Stable update function — reads latest values from refs
  const doUpdate = useCallback(async () => {
    // Cancel any in-flight requests
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const msgs = messagesRef.current;
    const logResult = logNextResultRef.current;
    logNextResultRef.current = false;
    try {
      let exceeds200kTokens = previousStateRef.current.exceeds200kTokens;

      // Only recalculate 200k check if messages changed
      const currentMessageId = getLastAssistantMessageId(msgs);
      if (currentMessageId !== previousStateRef.current.messageId) {
        exceeds200kTokens = doesMostRecentAssistantMessageExceed200k(msgs);
        previousStateRef.current.messageId = currentMessageId;
        previousStateRef.current.exceeds200kTokens = exceeds200kTokens;
      }
      const statusInput = buildStatusLineCommandInput(permissionModeRef.current, exceeds200kTokens, settingsRef.current, msgs, Array.from(addedDirsRef.current.keys()), mainLoopModelRef.current, vimModeRef.current);
      const text = await executeStatusLineCommand(statusInput, controller.signal, undefined, logResult);
      if (!controller.signal.aborted) {
        setAppState(prev => {
          if (prev.statusLineText === text) return prev;
          return {
            ...prev,
            statusLineText: text
          };
        });
      }
    } catch {
      // Silently ignore errors in status line updates
    }
  }, [messagesRef, setAppState]);

  // Stable debounced schedule function — no deps, uses refs
  const scheduleUpdate = useCallback(() => {
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout((ref, doUpdateFn) => {
      ref.current = undefined;
      void doUpdateFn();
    }, 300, debounceTimerRef, doUpdate);
  }, [doUpdate]);

  // Only trigger update when assistant message, permission mode, vim mode, or model actually changes
  useEffect(() => {
    if (lastAssistantMessageId !== previousStateRef.current.messageId || permissionMode !== previousStateRef.current.permissionMode || vimMode !== previousStateRef.current.vimMode || mainLoopModel !== previousStateRef.current.mainLoopModel) {
      // Don't update messageId here — let doUpdate handle it so
      // exceeds200kTokens is recalculated with the latest messages
      previousStateRef.current.permissionMode = permissionMode;
      previousStateRef.current.vimMode = vimMode;
      previousStateRef.current.mainLoopModel = mainLoopModel;
      scheduleUpdate();
    }
  }, [lastAssistantMessageId, permissionMode, vimMode, mainLoopModel, scheduleUpdate]);

  // When the statusLine command changes (hot reload), log the next result
  const statusLineCommand = settings?.statusLine?.command;
  const isFirstSettingsRender = useRef(true);
  useEffect(() => {
    if (isFirstSettingsRender.current) {
      isFirstSettingsRender.current = false;
      return;
    }
    logNextResultRef.current = true;
    void doUpdate();
  }, [statusLineCommand, doUpdate]);

  // Separate effect for logging on mount
  useEffect(() => {
    const statusLine = settings?.statusLine;
    if (statusLine) {
      logEvent('tengu_status_line_mount', {
        command_length: statusLine.command.length,
        padding: statusLine.padding
      });
      // Log if status line is configured but disabled by disableAllHooks
      if (settings.disableAllHooks === true) {
        logForDebugging('Status line is configured but disableAllHooks is true', {
          level: 'warn'
        });
      }
      // executeStatusLineCommand (hooks.ts) returns undefined when trust is
      // blocked — statusLineText stays undefined forever, user sees nothing,
      // and tengu_status_line_mount above fires anyway so telemetry looks fine.
      if (!checkHasTrustDialogAccepted()) {
        addNotification({
          key: 'statusline-trust-blocked',
          text: 'statusline skipped · restart to fix',
          color: 'warning',
          priority: 'low'
        });
        logForDebugging('Status line command skipped: workspace trust not accepted', {
          level: 'warn'
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, []); // Only run once on mount - settings stable for initial logging

  // Initial update on mount + cleanup on unmount
  useEffect(() => {
    void doUpdate();
    return () => {
      abortControllerRef.current?.abort();
      if (debounceTimerRef.current !== undefined) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, []); // Only run once on mount, not when doUpdate changes

  // Get padding from settings or default to 0
  const paddingX = settings?.statusLine?.padding ?? 0;

  // Goal lifecycle — PRESERVADO da versão anterior (estados reais, sem barra falsa).
  const isCompleted = !!goalCompletedAt
  const isWorking = !isCompleted && goalIsLoading === true

  // Auto-clear goal 2.5s after completion signal (goalCompletedAt set by /goal clear or stop hook)
  useEffect(() => {
    if (!goalCompletedAt) return
    const id = setTimeout(() => {
      setAppState(prev => ({
        ...prev,
        currentGoal: undefined,
        goalSetAt: undefined,
        goalIsLoading: undefined,
        goalCompletedAt: undefined,
      }))
    }, 2500)
    return () => clearTimeout(id)
  }, [goalCompletedAt, setAppState])

  // Auto-complete goal when Claude finishes a turn (goalIsLoading: true → false).
  // Sets goalCompletedAt so the goal settles "done" for 2.5 s then clears.
  const prevGoalIsLoadingRef = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    const prev = prevGoalIsLoadingRef.current
    prevGoalIsLoadingRef.current = goalIsLoading ?? undefined
    if (prev === true && goalIsLoading !== true && currentGoal && !goalCompletedAt) {
      setAppState(prev => ({ ...prev, goalCompletedAt: Date.now() }))
    }
  }, [goalIsLoading, currentGoal, goalCompletedAt, setAppState])

  // Track spinnerTip changes for stall detection (wall-clock, not animation time)
  const stalledRef = useRef<{ tip: string | undefined; since: number }>({ tip: undefined, since: Date.now() })
  if (spinnerTip !== stalledRef.current.tip) {
    stalledRef.current = { tip: spinnerTip, since: Date.now() }
  }

  const stalledMs = isWorking ? Date.now() - stalledRef.current.since : 0
  const isStalled = isWorking && stalledMs > 120000 // 2+ min same spinnerTip = stalled

  const goalText = currentGoal
    ? currentGoal.length > 48 ? currentGoal.slice(0, 48) + '…' : currentGoal
    : null

  // Badge de memória — SÓ quando o heap está sob pressão (pressure !== 'normal').
  // Sinal de OOM real, não decoração. Roxo nunca: usa cor de SINAL.
  const memBadge = heap
    ? <Text color={role(heap.pressure === 'critical' || heap.pressure === 'high' ? 'signalError' : 'signalWarn')}>{`${heap.pct}%`}</Text>
    : null

  // UM estado dominante por vez. Prioridade decrescente; cai para nada (efêmero)
  // em repouso. Itens separados pelo gap do Row, nunca por | ou ·.
  let content: React.ReactNode = null

  if (goalText && goalSetAt) {
    // Glyph mapeia o estado real: completo (assenta) | parado (aguardando) | trabalhando.
    const spec = isCompleted ? SETTLE_SUCCESS : isStalled ? WAITING : THINKING
    const glyphColor = isCompleted ? role('signalOk') : isStalled ? role('signalWarn') : role('accent')
    const labelColor = isWorking ? role('accent') : undefined
    content = (
      <Row gap="tight" fill={!!memBadge} trailing={memBadge}>
        <Glyph spec={spec} color={glyphColor} />
        <Text color={labelColor} dimColor={!isWorking && !isCompleted && !isStalled} wrap="truncate">{goalText}</Text>
      </Row>
    )
  } else if (networkRecovering) {
    // Modo em palavra minúscula, sem barra/spinner manual — engine cuida do clock.
    content = (
      <Row gap="tight" fill={!!memBadge} trailing={memBadge}>
        <Glyph spec={WAITING} color={role('signalWarn')} />
        <Text dimColor>rede — aguardando</Text>
      </Row>
    )
  } else if (statusLineText) {
    // Comando de statusline do usuário: render cru via Ansi, com badge à direita se houver.
    content = (
      <Row gap="gutter" fill={!!memBadge} trailing={memBadge}>
        <Text dimColor wrap="truncate"><Ansi>{statusLineText}</Ansi></Text>
      </Row>
    )
  } else if (memBadge) {
    // Nada acontecendo, mas o heap está sob pressão: o sinal sozinho ainda importa.
    content = <Row gap="tight">{memBadge}</Row>
  } else if (isFullscreenEnvEnabled()) {
    // Reserva a linha em fullscreen para não roubar uma linha do ScrollBox.
    content = <Text> </Text>
  }

  return <Box paddingX={paddingX}>{content}</Box>;
}

// Parent (PromptInputFooter) re-renders on every setMessages, but StatusLine's
// own props now only change when lastAssistantMessageId flips — memo keeps it
// from being dragged along (previously ~18 no-prop-change renders per session).
export const StatusLine = memo(StatusLineInner);
