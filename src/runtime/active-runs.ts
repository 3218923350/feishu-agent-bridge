import type { AgentRun } from '../agent/types.js'

export interface RunHandle {
  scopeId: string
  run: AgentRun
  interrupted: boolean
}

export class ActiveRuns {
  private readonly runs = new Map<string, RunHandle>()
  private pausedReason: string | null = null

  reserve(scopeId: string): boolean {
    return !this.runs.has(scopeId)
  }

  register(scopeId: string, run: AgentRun): RunHandle {
    if (this.runs.has(scopeId)) throw new Error(`run already active for ${scopeId}`)
    const handle = { scopeId, run, interrupted: false }
    this.runs.set(scopeId, handle)
    return handle
  }

  get(scopeId: string): RunHandle | undefined {
    return this.runs.get(scopeId)
  }

  unregister(scopeId: string, run?: AgentRun): void {
    const current = this.runs.get(scopeId)
    if (!current) return
    if (run && current.run !== run) return
    this.runs.delete(scopeId)
  }

  list(): RunHandle[] {
    return Array.from(this.runs.values())
  }

  pauseNewRuns(reason: string): void {
    this.pausedReason = reason
  }

  resumeNewRuns(): void {
    this.pausedReason = null
  }

  newRunsPaused(): boolean {
    return this.pausedReason !== null
  }

  newRunsPauseReason(): string | null {
    return this.pausedReason
  }
}

