import { randomUUID } from 'node:crypto'
import type { AgentAdapter, AgentEvent, AgentRun } from '../agent/types.js'
import type { BridgeConfig } from '../config/schema.js'
import { ActiveRuns } from './active-runs.js'
import { ProcessPool } from './process-pool.js'

export interface SubmitRunInput {
  scopeId: string
  agent: AgentAdapter
  prompt: string
  cwd: string
  sessionId?: string
  threadId?: string
  model?: string
  extraArgs?: string[]
  env?: Record<string, string>
  images?: readonly string[]
}

export interface RunExecution {
  runId: string
  scopeId: string
  run: AgentRun
  subscribe(): AsyncIterable<AgentEvent>
  stop(): Promise<void>
}

export class RunExecutor {
  readonly activeRuns = new ActiveRuns()
  readonly pool: ProcessPool

  constructor(config: BridgeConfig) {
    this.pool = new ProcessPool(config.defaults.max_concurrent_sessions)
  }

  async submit(input: SubmitRunInput): Promise<RunExecution> {
    if (this.activeRuns.newRunsPaused()) {
      throw new Error(this.activeRuns.newRunsPauseReason() ?? 'new runs paused')
    }
    if (!this.activeRuns.reserve(input.scopeId)) {
      throw new Error(`run already active for ${input.scopeId}`)
    }
    const release = await this.pool.acquire()
    const runId = randomUUID()
    let run: AgentRun
    try {
      const options = {
        runId,
        prompt: input.prompt,
        cwd: input.cwd,
        sessionId: input.sessionId,
        threadId: input.threadId,
        model: input.model,
        extraArgs: input.extraArgs,
        env: input.env,
        images: input.images,
      }
      await input.agent.prepareRun?.(options)
      run = input.agent.run(options)
    } catch (error) {
      release()
      throw error
    }

    const handle = this.activeRuns.register(input.scopeId, run)
    let cleaned = false
    const cleanup = async (waitForExit: boolean): Promise<void> => {
      if (cleaned) return
      cleaned = true
      this.activeRuns.unregister(input.scopeId, run)
      release()
      if (waitForExit && !handle.interrupted) {
        const exited = await run.waitForExit(2000)
        if (!exited) await run.stop().catch(() => {})
      }
    }
    const fanout = new EventFanout(run.events, async () => {
      await cleanup(true)
    })

    return {
      runId,
      scopeId: input.scopeId,
      run,
      subscribe: () => fanout.subscribe(),
      stop: async () => {
        handle.interrupted = true
        await run.stop()
        await cleanup(false)
      },
    }
  }
}

class EventFanout {
  private readonly buffer: AgentEvent[] = []
  private readonly waiters = new Set<() => void>()
  private started = false
  private done = false
  private error: unknown

  constructor(
    private readonly source: AsyncIterable<AgentEvent>,
    private readonly onDone: () => Promise<void>,
  ) {}

  subscribe(): AsyncIterable<AgentEvent> {
    return {
      [Symbol.asyncIterator]: () => {
        let index = 0
        return {
          next: async (): Promise<IteratorResult<AgentEvent>> => {
            this.start()
            if (index < this.buffer.length) return { done: false, value: this.buffer[index++]! }
            if (this.error) throw this.error
            if (this.done) return { done: true, value: undefined }
            await new Promise<void>((resolve) => this.waiters.add(resolve))
            if (index < this.buffer.length) return { done: false, value: this.buffer[index++]! }
            if (this.error) throw this.error
            return { done: true, value: undefined }
          },
        }
      },
    }
  }

  private start(): void {
    if (this.started) return
    this.started = true
    void this.pump()
  }

  private async pump(): Promise<void> {
    try {
      for await (const event of this.source) {
        this.buffer.push(event)
        this.wake()
        if (event.type === 'done' || event.type === 'error') break
      }
    } catch (error) {
      this.error = error
    } finally {
      this.done = true
      this.wake()
      await this.onDone().catch(() => {})
    }
  }

  private wake(): void {
    for (const waiter of this.waiters) waiter()
    this.waiters.clear()
  }
}
