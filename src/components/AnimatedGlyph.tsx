import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Text } from '../ink.js'
import type { Color } from '../ink/styles.js'
import type { Theme } from '../utils/theme.js'

type Props = {
  frames: readonly string[]
  /** Milliseconds per frame. Default: 80 */
  interval?: number
  /** Number of full loops before settling. 0 = infinite. Default: 1 */
  loops?: number
  /** Character shown after animation completes. Falls back to last frame. */
  settle?: string
  /** Ink color name. When omitted, renders dimColor. */
  color?: keyof Theme | Color
}

export function AnimatedGlyph({
  frames,
  interval = 80,
  loops = 1,
  settle,
  color,
}: Props): React.ReactNode {
  const [idx, setIdx] = useState(0)
  const [done, setDone] = useState(false)
  const loopCount = useRef(0)
  const mountedRef = useRef(true)

  // Reset animation when frames or loop config changes so a new animation
  // always starts fresh. loopCount is reset here so subsequent ticks don't
  // see stale counts from a prior animation run.
  useEffect(() => {
    setIdx(0)
    setDone(false)
    loopCount.current = 0
  }, [frames, loops])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (done) return
    const id = setInterval(() => {
      if (!mountedRef.current) return
      setIdx(prev => {
        const next = prev + 1
        if (next < frames.length) return next
        loopCount.current += 1
        if (loops > 0 && loopCount.current >= loops) {
          setDone(true)
          return prev
        }
        return 0
      })
    }, interval)
    return () => clearInterval(id)
  }, [done, frames, interval, loops])

  const char = done
    ? (settle ?? frames[frames.length - 1] ?? '')
    : (frames[idx] ?? frames[0] ?? '')

  return color
    ? <Text color={color}>{char}</Text>
    : <Text dimColor>{char}</Text>
}
