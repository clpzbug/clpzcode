import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useMailbox } from '../context/mailbox.js'

type Props = {
  isLoading: boolean
  onSubmitMessage: (content: string) => boolean
}

export function useMailboxBridge({ isLoading, onSubmitMessage }: Props): void {
  const mailbox = useMailbox()

  const subscribe = useMemo(() => mailbox.subscribe.bind(mailbox), [mailbox])
  const getSnapshot = useCallback(() => mailbox.revision, [mailbox])
  const revision = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    if (isLoading) return
    const msg = mailbox.poll()
    if (!msg) return
    const accepted = onSubmitMessage(msg.content)
    // If rejected, put back at front of queue for the next cycle.
    // Avoids silent drop when onSubmitMessage returns false.
    if (!accepted) mailbox.unshift(msg)
  }, [isLoading, revision, mailbox, onSubmitMessage])
}
