const NO_VALUE = Symbol('NO_VALUE')

export async function lastX<A>(as: AsyncGenerator<A>): Promise<A> {
  let lastValue: A | typeof NO_VALUE = NO_VALUE
  for await (const a of as) {
    lastValue = a
  }
  if (lastValue === NO_VALUE) {
    throw new Error('No items in generator')
  }
  return lastValue
}

export async function returnValue<A>(
  as: AsyncGenerator<unknown, A>,
): Promise<A> {
  // try/finally so a throw mid-drain (or an abandoned promise) still runs the
  // source generator's finally — the manual next() loop, unlike for-await,
  // doesn't call .return() on its own. (STREAM-3, mirrors all()'s cleanup.)
  try {
    let e
    do {
      e = await as.next()
    } while (!e.done)
    return e.value
  } finally {
    await as.return(undefined as never).catch(() => {})
  }
}

type QueuedGenerator<A> = {
  done: boolean | void
  value: A | void
  generator: AsyncGenerator<A, void>
  promise: Promise<QueuedGenerator<A>>
}

// Run all generators concurrently up to a concurrency cap, yielding values as they come in
export async function* all<A>(
  generators: AsyncGenerator<A, void>[],
  concurrencyCap = Infinity,
): AsyncGenerator<A, void> {
  // Track the generator behind each in-flight promise so that, if one rejects,
  // the siblings can be told to clean up instead of being abandoned.
  const inFlight = new Map<Promise<QueuedGenerator<A>>, AsyncGenerator<A, void>>()
  const next = (generator: AsyncGenerator<A, void>) => {
    const promise: Promise<QueuedGenerator<A>> = generator
      .next()
      .then(({ done, value }) => ({
        done,
        value,
        generator,
        promise,
      }))
    inFlight.set(promise, generator)
    return promise
  }
  const waiting = [...generators]
  const promises = new Set<Promise<QueuedGenerator<A>>>()

  // Start initial batch up to concurrency cap
  while (promises.size < concurrencyCap && waiting.length > 0) {
    const gen = waiting.shift()!
    promises.add(next(gen))
  }

  // Close every still-in-flight child so its finally runs (releasing tools /
  // in-progress IDs) and swallow its pending settlement. Idempotent.
  const cleanup = async () => {
    for (const p of promises) p.catch(() => {})
    const remaining = [...inFlight.values()]
    promises.clear()
    inFlight.clear()
    await Promise.all(remaining.map(g => g.return(undefined).catch(() => {})))
  }

  // try/finally so BOTH a rejected child AND early-return (consumer break, or
  // .return() on abort/Ctrl+C/turn-end) close the in-flight children — not just
  // the rejection path.
  try {
    while (promises.size > 0) {
      const settled: QueuedGenerator<A> = await Promise.race(promises)
      const { done, value, generator, promise } = settled
      promises.delete(promise)
      inFlight.delete(promise)

      if (!done) {
        promises.add(next(generator))
        // A !done step always carries a real yielded value; yield it
        // unconditionally so a legitimate `undefined` yield isn't dropped
        // (done already discriminates completion).
        yield value as A
      } else if (waiting.length > 0) {
        // Start a new generator when one finishes
        const nextGen = waiting.shift()!
        promises.add(next(nextGen))
      }
    }
  } finally {
    await cleanup()
  }
}

export async function toArray<A>(
  generator: AsyncGenerator<A, void>,
): Promise<A[]> {
  const result: A[] = []
  for await (const a of generator) {
    result.push(a)
  }
  return result
}

export async function* fromArray<T>(values: T[]): AsyncGenerator<T, void> {
  for (const value of values) {
    yield value
  }
}
