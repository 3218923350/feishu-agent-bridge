export class ProcessPool {
  private active = 0
  private readonly waiters: Array<(release: () => void) => void> = []

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) return this.take()
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  tryAcquire(): (() => void) | null {
    return this.active < this.max ? this.take() : null
  }

  private take(): () => void {
    this.active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      const next = this.waiters.shift()
      if (next) next(this.take())
    }
  }
}

