import { describe, it, expect } from 'vitest'
import { runWithConcurrency } from '../utils/concurrency.js'

describe('runWithConcurrency', () => {
  it('preserves result order even when tasks resolve out of order', async () => {
    // Task 0 takes longest, task 2 resolves first — result must still be [0, 1, 2]
    const delays = [30, 10, 0]
    const tasks = delays.map((delay, i) => () =>
      new Promise<number>(resolve => setTimeout(() => resolve(i), delay)),
    )
    const results = await runWithConcurrency(tasks, 3)
    expect(results).toEqual([0, 1, 2])
  })

  it('limits concurrency to the configured maximum', async () => {
    let active = 0
    let peak = 0
    const tasks = Array.from({ length: 10 }, () => async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
    })
    await runWithConcurrency(tasks, 3)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('stops issuing new tasks after one fails', async () => {
    let started = 0
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      started++
      if (i === 2) throw new Error('chunk failed')
    })
    await expect(runWithConcurrency(tasks, 1)).rejects.toThrow('chunk failed')
    // With concurrency 1 and fail-fast, at most 3 tasks (0, 1, 2) should have started
    expect(started).toBeLessThanOrEqual(3)
  })

  it('throws RangeError for concurrency < 1', async () => {
    await expect(runWithConcurrency([async () => 1], 0)).rejects.toThrow(RangeError)
    await expect(runWithConcurrency([async () => 1], -1)).rejects.toThrow(RangeError)
  })

  it('returns empty array for empty task list', async () => {
    const results = await runWithConcurrency([], 4)
    expect(results).toEqual([])
  })
})
