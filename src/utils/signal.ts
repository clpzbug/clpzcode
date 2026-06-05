/**
 * Tiny listener-set primitive for pure event signals (no stored state).
 *
 * Collapses the ~8-line `const listeners = new Set(); function subscribe(){…};
 * function notify(){for(const l of listeners) l()}` boilerplate that was
 * duplicated ~15× across the codebase into a one-liner.
 *
 * Distinct from a store (AppState, createStore) — there is no snapshot, no
 * getState. Use this when subscribers only need to know "something happened",
 * optionally with event args, not "what is the current value".
 *
 * Usage:
 *   const changed = createSignal<[SettingSource]>()
 *   export const subscribe = changed.subscribe
 *   // later: changed.emit('userSettings')
 */

import { logError } from './log.js'

export type Signal<Args extends unknown[] = []> = {
  /** Subscribe a listener. Returns an unsubscribe function. */
  subscribe: (listener: (...args: Args) => void) => () => void
  /** Call all subscribed listeners with the given arguments. */
  emit: (...args: Args) => void
  /** Remove all listeners. Useful in dispose/reset paths. */
  clear: () => void
}

export function createSignal<Args extends unknown[] = []>(): Signal<Args> {
  const listeners = new Set<(...args: Args) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(...args) {
      // Isolate listeners: one throwing subscriber must not abort fan-out to the
      // rest (nor escape emit() as an unhandled rejection).
      for (const listener of listeners) {
        try {
          listener(...args)
        } catch (err) {
          logError(err)
        }
      }
    },
    clear() {
      listeners.clear()
    },
  }
}
