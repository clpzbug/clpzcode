import { type RefObject } from 'react'
import * as React from 'react'
import { Box } from '../ink.js'
import { ModalContext } from '../context/modalContext.js'
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js'

const MAX_CARD_WIDTH = 88

export type CardLayout = {
  /** Vertical offset that biases the card toward the upper-middle. */
  paddingTop: number
  /** Outer card width (border + paddingX included). */
  cardWidth: number
  /** Outer card max height (border included). */
  cardMaxHeight: number
  /** Inner content columns = card minus border(2) + paddingX(4). */
  innerColumns: number
  /** Inner content rows = card minus border(2). */
  innerRows: number
}

/**
 * Pure geometry for the centered modal card. Kept separate + exported so the
 * sizing math — the one real failure mode (wrong inner size → content clips or
 * overflows) — is unit-testable without rendering the absolute-positioned card
 * (which renderToString cannot render).
 */
export function computeCardLayout(columns: number, terminalRows: number): CardLayout {
  const paddingTop = Math.floor(terminalRows / 4)
  const cardWidth = Math.min(columns - 4, MAX_CARD_WIDTH)
  const cardMaxHeight = Math.max(3, terminalRows - paddingTop - 2)
  const innerColumns = Math.max(1, cardWidth - 6)
  const innerRows = Math.max(1, cardMaxHeight - 2)
  return { paddingTop, cardWidth, cardMaxHeight, innerColumns, innerRows }
}

type CenteredModalProps = {
  modal: React.ReactNode
  columns: number
  terminalRows: number
  modalScrollRef?: RefObject<ScrollBoxHandle | null>
}

/**
 * Renders the fullscreen slash-command modal slot as an opencode-style
 * upper-middle floating CARD (rounded border, opaque surface) over the still-
 * visible transcript — instead of the old bottom-anchored full-width strip.
 *
 * Provides ModalContext sized to the card's INNER content area (border +
 * paddingX subtracted) so Pane/Tabs/Select page to the card, not the whole
 * terminal. Only the slash-command modal flows through this slot; permission /
 * sandbox / cost / callout dialogs use other slots and are untouched.
 */
export function CenteredModal({
  modal,
  columns,
  terminalRows,
  modalScrollRef,
}: CenteredModalProps): React.ReactNode {
  const { paddingTop, cardWidth, cardMaxHeight, innerColumns, innerRows } =
    computeCardLayout(columns, terminalRows)
  return (
    <ModalContext
      value={{
        rows: innerRows,
        columns: innerColumns,
        scrollRef: modalScrollRef ?? null,
      }}
    >
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        flexDirection="column"
        alignItems="center"
        paddingTop={paddingTop}
      >
        <Box
          flexDirection="column"
          width={cardWidth}
          maxHeight={cardMaxHeight}
          borderStyle="round"
          borderColor="border"
          paddingX={2}
          overflow="hidden"
          opaque={true}
        >
          {modal}
        </Box>
      </Box>
    </ModalContext>
  )
}
