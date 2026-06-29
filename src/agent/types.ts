export type AgentId = 'claude' | 'codex'

export type AgentEvent =
  | { type: 'system'; sessionId?: string; threadId?: string; cwd?: string; model?: string }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | {
      type: 'usage'
      inputTokens?: number
      outputTokens?: number
      cachedInputTokens?: number
      reasoningOutputTokens?: number
      costUsd?: number
    }
  | { type: 'done'; sessionId?: string; threadId?: string; terminationReason: 'normal' | 'interrupted' | 'timeout' }
  | { type: 'error'; message: string; terminationReason: 'failed' | 'interrupted' | 'timeout' }

export interface AgentRunOptions {
  runId: string
  prompt: string
  cwd: string
  sessionId?: string
  threadId?: string
  model?: string
  extraArgs?: string[]
  env?: Record<string, string>
  images?: readonly string[]
  stopGraceMs?: number
}

export interface AgentRun {
  readonly runId: string
  readonly events: AsyncIterable<AgentEvent>
  stop(): Promise<void>
  waitForExit(timeoutMs: number): Promise<boolean>
}

export interface AgentAdapter {
  readonly id: AgentId
  readonly displayName: string
  isAvailable(): Promise<boolean>
  prepareRun?(opts: AgentRunOptions): Promise<void>
  run(opts: AgentRunOptions): AgentRun
}

