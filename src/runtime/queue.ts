interface PendingEntry<T> {
  messages: T[]
  timer?: NodeJS.Timeout
}

export type FlushHandler<T> = (scopeId: string, batch: T[]) => void

export class PendingQueue<T> {
  private readonly entries = new Map<string, PendingEntry<T>>()
  private readonly blocked = new Set<string>()

  constructor(
    private readonly delayMs: number,
    private readonly onFlush: FlushHandler<T>,
  ) {}

  push(scopeId: string, message: T): number {
    const entry = this.entries.get(scopeId) ?? { messages: [] }
    if (entry.timer) clearTimeout(entry.timer)
    entry.messages.push(message)
    entry.timer = this.blocked.has(scopeId) ? undefined : this.arm(scopeId)
    this.entries.set(scopeId, entry)
    return entry.messages.length
  }

  block(scopeId: string): void {
    this.blocked.add(scopeId)
    const entry = this.entries.get(scopeId)
    if (entry?.timer) clearTimeout(entry.timer)
    if (entry) entry.timer = undefined
  }

  unblock(scopeId: string): void {
    this.blocked.delete(scopeId)
    const entry = this.entries.get(scopeId)
    if (!entry?.messages.length) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = this.arm(scopeId)
  }

  cancel(scopeId: string): T[] {
    const entry = this.entries.get(scopeId)
    if (!entry) return []
    if (entry.timer) clearTimeout(entry.timer)
    this.entries.delete(scopeId)
    return entry.messages
  }

  private arm(scopeId: string): NodeJS.Timeout {
    return setTimeout(() => this.flush(scopeId), this.delayMs)
  }

  private flush(scopeId: string): void {
    const entry = this.entries.get(scopeId)
    if (!entry) return
    this.entries.delete(scopeId)
    this.onFlush(scopeId, entry.messages)
  }
}
