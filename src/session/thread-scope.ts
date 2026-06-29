import type { AgentId } from '../agent/types.js'

export interface TrackState {
  agentId: AgentId
  sessionId?: string
  threadId?: string
  lastRunId?: string
}

export interface ThreadScope {
  scopeId: string
  chatId: string
  threadId: string
  projectPath: string
  createdAt: string
  updatedAt: string
  mainTrack: TrackState
  reviewTrack: TrackState
}

export function createThreadScope(input: { chatId: string; threadId: string; projectPath: string }): ThreadScope {
  const now = new Date().toISOString()
  return {
    scopeId: `${input.chatId}:${input.threadId}`,
    chatId: input.chatId,
    threadId: input.threadId,
    projectPath: input.projectPath,
    createdAt: now,
    updatedAt: now,
    mainTrack: { agentId: 'claude' },
    reviewTrack: { agentId: 'codex' },
  }
}

