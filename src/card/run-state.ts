import type { AgentEvent } from '../agent/types.js'

export type ToolStatus = 'running' | 'done' | 'error'

export interface ToolEntry {
  id: string
  name: string
  input: unknown
  status: ToolStatus
  output?: string
}

export type Block =
  | { kind: 'text'; content: string; streaming: boolean }
  | { kind: 'tool'; tool: ToolEntry }

export type FooterStatus = 'thinking' | 'tool_running' | 'streaming' | null
export type Terminal = 'running' | 'done' | 'interrupted' | 'error' | 'idle_timeout'

export interface RunState {
  blocks: Block[]
  reasoning: { content: string; active: boolean }
  footer: FooterStatus
  terminal: Terminal
  errorMsg?: string
}

export const initialRunState: RunState = {
  blocks: [],
  reasoning: { content: '', active: false },
  footer: 'thinking',
  terminal: 'running',
}

export function reduceRunState(state: RunState, event: AgentEvent): RunState {
  switch (event.type) {
    case 'text': {
      const last = state.blocks.at(-1)
      const nextText = last?.kind === 'text' && last.streaming
        ? { ...last, content: last.content + event.delta }
        : { kind: 'text' as const, content: event.delta, streaming: true }
      return {
        ...state,
        blocks: last?.kind === 'text' && last.streaming
          ? [...state.blocks.slice(0, -1), nextText]
          : [...closeStreamingText(state.blocks), nextText],
        reasoning: { ...state.reasoning, active: false },
        footer: 'streaming',
      }
    }

    case 'thinking':
      return {
        ...state,
        reasoning: { content: state.reasoning.content + event.delta, active: true },
        footer: 'thinking',
      }

    case 'tool_use':
      return {
        ...state,
        blocks: [
          ...closeStreamingText(state.blocks),
          { kind: 'tool', tool: { id: event.id, name: event.name, input: event.input, status: 'running' } },
        ],
        reasoning: { ...state.reasoning, active: false },
        footer: 'tool_running',
      }

    case 'tool_result':
      return {
        ...state,
        blocks: state.blocks.map((block) => block.kind === 'tool' && block.tool.id === event.id
          ? {
              ...block,
              tool: {
                ...block.tool,
                status: event.isError ? 'error' : 'done',
                output: event.output,
              },
            }
          : block),
      }

    case 'done':
      return {
        ...state,
        blocks: closeStreamingText(state.blocks),
        reasoning: { ...state.reasoning, active: false },
        footer: null,
        terminal: event.terminationReason === 'interrupted' ? 'interrupted' : event.terminationReason === 'timeout' ? 'idle_timeout' : 'done',
      }

    case 'error':
      return {
        ...state,
        blocks: closeStreamingText(state.blocks),
        reasoning: { ...state.reasoning, active: false },
        footer: null,
        terminal: event.terminationReason === 'interrupted' ? 'interrupted' : event.terminationReason === 'timeout' ? 'idle_timeout' : 'error',
        errorMsg: event.message,
      }

    default:
      return state
  }
}

export function markInterrupted(state: RunState): RunState {
  return { ...state, blocks: closeStreamingText(state.blocks), footer: null, terminal: 'interrupted' }
}

function closeStreamingText(blocks: Block[]): Block[] {
  return blocks.map((block) => block.kind === 'text' && block.streaming ? { ...block, streaming: false } : block)
}

