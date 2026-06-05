// src/tui/startup/ZenLogo.tsx
//
// Header de startup "Zen puro" — substitui a apresentação de LogoV2.tsx e
// CondensedLogo.tsx (caixa redonda + Clawd + FeedColumn + título "OPEN CLAUDE").
//
// Colapsa o header de ~15-20 linhas para um bloco minimalista:
//
//   ◈  clpzcode  v1.2.3
//   ········································
//   Model   Opus 4.8 (1M)
//   Path    ~/projeto
//   Mode    Pro
//
// Sem borda em volta. Monocromático + UM accent (só o mark do boot). A marca
// é clpzcode (corrige "OPEN CLAUDE"). Toda a LÓGICA de dados e os side-effects
// do componente compilado são preservados literalmente; só a APRESENTAÇÃO muda.
//
// NOTA DE INTEGRAÇÃO: o OffscreenFreeze é provido pelo LogoHeader em
// Messages.tsx (que envolve <ZenLogo/>). Para não aninhar dois freezes, este
// componente NÃO usa OffscreenFreeze interno.

import * as React from 'react'
import { useEffect, useState } from 'react'
import { Box, Text } from '../../ink.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { stringWidth } from '../../ink/stringWidth.js'
import {
  getLogoDisplayData,
  truncatePath,
} from '../../utils/logoV2Utils.js'
import { truncate } from '../../utils/format.js'
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js'
import { getInitialSettings } from 'src/utils/settings/settings.js'
import { isDebugMode, isDebugToStdErr, getDebugLogPath } from 'src/utils/debug.js'
import {
  shouldShowProjectOnboarding,
  incrementProjectOnboardingSeenCount,
} from '../../projectOnboardingState.js'
import { checkForReleaseNotesSync } from '../../utils/releaseNotes.js'
import { publicBuildVersion } from '../../utils/version.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { EmergencyTip } from '../../components/LogoV2/EmergencyTip.js'
import { VoiceModeNotice } from '../../components/LogoV2/VoiceModeNotice.js'
import { feature } from 'bun:bundle'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import {
  useShowGuestPassesUpsell,
  incrementGuestPassesSeenCount,
} from '../../components/LogoV2/GuestPassesUpsell.js'
import {
  useShowOverageCreditUpsell,
  incrementOverageCreditUpsellSeenCount,
} from '../../components/LogoV2/OverageCreditUpsell.js'
import { useAppState } from '../../state/AppState.js'
import { getEffortSuffix } from '../../utils/effort.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { renderModelSetting } from '../../utils/model/model.js'
import { Row, role } from '../design/index.js'

// Mesmo padrão de tree-shake do LogoV2 original: o módulo só existe quando o
// flag está ligado, então o require condicional elimina o arquivo inteiro.
/* eslint-disable @typescript-eslint/no-require-imports */
const ChannelsNoticeModule =
  feature('KAIROS') || feature('KAIROS_CHANNELS')
    ? (require('../../components/LogoV2/ChannelsNotice.js') as typeof import('../../components/LogoV2/ChannelsNotice.js'))
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

// Largura do label antes do valor (alinha Model/Path/Mode). 7 = "Model" + 2.
const LABEL_WIDTH = 7
// Teto de largura do bloco de dados, pra não cruzar a tela inteira.
const DATA_MAX_WIDTH = 56

// Estado de AppState (mantém os mesmos seletores do compilado).
const selectAgent = (s: { agent?: string }) => s.agent
const selectEffort = (s: { effortValue?: unknown }) => s.effortValue

type FieldProps = { label: string; value: string }

function Field({ label, value }: FieldProps): React.ReactNode {
  return (
    <Row gap="none">
      <Box width={LABEL_WIDTH}>
        <Text color={role('muted')}>{label}</Text>
      </Box>
      <Text color={role('faint')}>{value}</Text>
    </Row>
  )
}

export function ZenLogo(): React.ReactNode {
  const { columns } = useTerminalSize()

  // ── Lógica preservada do LogoV2/CondensedLogo (dados + side-effects) ──────
  const [showOnboarding] = useState(() => shouldShowProjectOnboarding())
  const [showSandboxStatus] = useState(() => SandboxManager.isSandboxingEnabled())
  const showGuestPassesUpsell = useShowGuestPassesUpsell()
  const showOverageCreditUpsell = useShowOverageCreditUpsell()
  const agent = useAppState(selectAgent)
  const effortValue = useAppState(selectEffort)
  const config = getGlobalConfig()

  const { hasReleaseNotes } = checkForReleaseNotesSync(config.lastReleaseNotesSeen)

  const [announcement] = useState(() => {
    const announcements = getInitialSettings().companyAnnouncements
    if (!announcements || announcements.length === 0) return undefined
    return config.numStartups === 1
      ? announcements[0]
      : announcements[Math.floor(Math.random() * announcements.length)]
  })

  // Marca releaseNotes como vistas (efeito idêntico ao original).
  useEffect(() => {
    const current = getGlobalConfig()
    if (current.lastReleaseNotesSeen === publicBuildVersion) return
    saveGlobalConfig(prev =>
      prev.lastReleaseNotesSeen === publicBuildVersion
        ? prev
        : { ...prev, lastReleaseNotesSeen: publicBuildVersion },
    )
    if (showOnboarding) incrementProjectOnboardingSeenCount()
  }, [config, showOnboarding])

  const isCondensedMode =
    !hasReleaseNotes &&
    !showOnboarding &&
    !isEnvTruthy(process.env.CLAUDE_CODE_FORCE_FULL_LOGO)

  // Increments de "visto" — preservados literalmente do compilado.
  useEffect(() => {
    if (showGuestPassesUpsell && !showOnboarding && !isCondensedMode) {
      incrementGuestPassesSeenCount()
    }
  }, [showGuestPassesUpsell, showOnboarding, isCondensedMode])

  useEffect(() => {
    if (
      showOverageCreditUpsell &&
      !showOnboarding &&
      !showGuestPassesUpsell &&
      !isCondensedMode
    ) {
      incrementOverageCreditUpsellSeenCount()
    }
  }, [showOverageCreditUpsell, showOnboarding, showGuestPassesUpsell, isCondensedMode])

  const model = useMainLoopModel()
  const fullModelDisplayName = renderModelSetting(model)
  const { cwd, billingType, agentName: agentNameFromSettings } =
    getLogoDisplayData()
  const agentName = agent ?? agentNameFromSettings
  const effortSuffix = getEffortSuffix(model, effortValue)

  // ── Apresentação Zen ──────────────────────────────────────────────────────
  const dataWidth = Math.max(20, Math.min(columns - 2, DATA_MAX_WIDTH))
  const valueWidth = Math.max(10, dataWidth - LABEL_WIDTH)

  const modelDisplay = truncate(fullModelDisplayName + effortSuffix, valueWidth)
  const cwdAvail = agentName
    ? valueWidth - 1 - stringWidth(agentName) - 3
    : valueWidth
  const cwdDisplay = truncatePath(cwd, Math.max(cwdAvail, 10))
  const pathValue = agentName ? `@${agentName} · ${cwdDisplay}` : cwdDisplay

  // Notices a jusante — mesmos componentes/condições do LogoV2 original.
  const debugNotice = isDebugMode() ? (
    <Box flexDirection="column">
      <Text color={role('signalWarn')}>Debug mode enabled</Text>
      <Text color={role('faint')}>
        Logging to: {isDebugToStdErr() ? 'stderr' : getDebugLogPath()}
      </Text>
    </Box>
  ) : null

  const tmuxNotice = process.env.CLAUDE_CODE_TMUX_SESSION ? (
    <Box flexDirection="column">
      <Text color={role('faint')}>
        tmux session: {process.env.CLAUDE_CODE_TMUX_SESSION}
      </Text>
      <Text color={role('faint')}>
        {process.env.CLAUDE_CODE_TMUX_PREFIX_CONFLICTS
          ? `Detach: ${process.env.CLAUDE_CODE_TMUX_PREFIX} ${process.env.CLAUDE_CODE_TMUX_PREFIX} d (press prefix twice - Claude uses ${process.env.CLAUDE_CODE_TMUX_PREFIX})`
          : `Detach: ${process.env.CLAUDE_CODE_TMUX_PREFIX} d`}
      </Text>
    </Box>
  ) : null

  const announcementNotice = announcement ? (
    <Box flexDirection="column">
      <Text>{announcement}</Text>
    </Box>
  ) : null

  const sandboxNotice = showSandboxStatus ? (
    <Text color={role('signalWarn')}>
      Your bash commands will be sandboxed. Disable with /sandbox.
    </Text>
  ) : null

  return (
    <>
      <Box flexDirection="column">
        <Field label="Model" value={modelDisplay} />
        <Field label="Path" value={pathValue} />
        <Field label="Mode" value={billingType} />
      </Box>
      <VoiceModeNotice />
      {ChannelsNoticeModule && <ChannelsNoticeModule.ChannelsNotice />}
      {debugNotice}
      <EmergencyTip />
      {tmuxNotice}
      {announcementNotice}
      {sandboxNotice}
    </>
  )
}
