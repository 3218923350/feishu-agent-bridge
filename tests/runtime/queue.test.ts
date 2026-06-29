import { describe, expect, it, vi } from 'vitest'
import { PendingQueue } from '../../src/runtime/queue.js'

describe('PendingQueue', () => {
  it('holds messages while blocked and flushes after unblock', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const queue = new PendingQueue<{ text: string; chatId: string; messageId: string }>(100, (_scope, batch) => flushed.push(batch.map((msg) => msg.text)))
    queue.block('s1')
    queue.push('s1', { text: 'a', chatId: 'c', messageId: 'm1' })
    vi.advanceTimersByTime(200)
    expect(flushed).toEqual([])
    queue.unblock('s1')
    vi.advanceTimersByTime(100)
    expect(flushed).toEqual([['a']])
    vi.useRealTimers()
  })
})
