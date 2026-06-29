import type { AgentAdapter, AgentEvent } from '../agent/types.js'
import type { FeishuApi } from '../connector/api.js'
import type { BridgeConfig } from '../config/schema.js'
import { initialRunState, reduceRunState } from '../card/run-state.js'
import { renderRunCard } from '../card/run-renderer.js'
import type { RunExecutor } from '../runtime/run-executor.js'
import type { ThreadScope, TrackState } from '../session/thread-scope.js'

export interface RunTrackInput {
  scope: ThreadScope
  track: TrackState
  agent: AgentAdapter
  prompt: string
  replyToMessageId: string
}

export class SingleOrchestrator {
  constructor(
    private readonly api: FeishuApi,
    private readonly config: BridgeConfig,
    private readonly executor: RunExecutor,
  ) {}

  async runTrack(input: RunTrackInput): Promise<TrackState> {
    const cardMessageId = await this.api.replyCard(input.replyToMessageId, renderRunCard(initialRunState))
    let state = initialRunState
    let dirty = false
    let latestTrack = input.track

    const execution = await this.executor.submit({
      scopeId: input.scope.scopeId,
      agent: input.agent,
      prompt: input.prompt,
      cwd: input.scope.projectPath,
      sessionId: input.track.sessionId,
      threadId: input.track.threadId,
      model: this.agentConfig(input.agent.id).model,
      extraArgs: this.agentConfig(input.agent.id).extra_args,
      env: this.agentConfig(input.agent.id).env,
    })

    const timer = setInterval(() => {
      if (!dirty) return
      dirty = false
      this.api.updateCard(cardMessageId, renderRunCard(state, { stopValue: { cmd: 'stop', scopeId: input.scope.scopeId } })).catch(() => {})
    }, this.config.display.update_interval_ms)

    try {
      for await (const event of execution.subscribe()) {
        latestTrack = updateTrack(latestTrack, execution.runId, event)
        state = reduceRunState(state, event)
        dirty = true
      }
    } finally {
      clearInterval(timer)
      await this.api.updateCard(cardMessageId, renderRunCard(state, { stopValue: { cmd: 'stop', scopeId: input.scope.scopeId } })).catch(() => {})
    }

    return latestTrack
  }

  private agentConfig(agentId: 'claude' | 'codex') {
    return this.config.defaults[agentId]
  }
}

function updateTrack(track: TrackState, runId: string, event: AgentEvent): TrackState {
  if (event.type === 'system') {
    return { ...track, lastRunId: runId, sessionId: event.sessionId ?? track.sessionId, threadId: event.threadId ?? track.threadId }
  }
  if (event.type === 'done') {
    return { ...track, lastRunId: runId, sessionId: event.sessionId ?? track.sessionId, threadId: event.threadId ?? track.threadId }
  }
  return { ...track, lastRunId: runId }
}

