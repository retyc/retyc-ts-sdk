/**
 * Runs `tasks` with at most `concurrency` in-flight at once.
 * Results are returned in the same order as the input tasks.
 * Fails fast: once one task rejects, no new tasks are started and the error propagates.
 */
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  if (concurrency < 1) throw new RangeError(`concurrency must be >= 1, got ${concurrency}`)
  if (tasks.length === 0) return []

  const results: T[] = new Array(tasks.length)
  let cursor = 0
  let failed = false

  async function worker() {
    while (cursor < tasks.length && !failed) {
      const i = cursor++
      try {
        results[i] = await tasks[i]()
      } catch (err) {
        failed = true
        throw err
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return results
}
