import { ClaudeAdapter } from './claude/adapter.js'
import { CodexAdapter } from './codex/adapter.js'
import type { AgentAdapter, AgentId } from './types.js'

export function createAdapters(): Map<AgentId, AgentAdapter> {
  return new Map<AgentId, AgentAdapter>([
    ['claude', new ClaudeAdapter()],
    ['codex', new CodexAdapter()],
  ])
}

export type { AgentAdapter, AgentEvent, AgentId, AgentRun, AgentRunOptions } from './types.js'
