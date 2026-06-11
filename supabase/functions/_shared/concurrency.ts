// Bounded-concurrency async map. Like Promise.all(items.map(fn)) but never runs
// more than `limit` tasks at once — used to throttle FatSecret fan-out so a single
// meal-generation request (N meals × M ingredients × 2 calls) can't fire ~100
// concurrent requests and trip rate limits / exhaust sockets. Preserves input order.
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  // Spin up `limit` workers that each pull the next index until the queue drains.
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++ // claim an index before awaiting so workers don't double-process
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}
