import type { AgentEvent } from '../types.js'

export function normalizeClaudeEvent(raw: any): AgentEvent | null {
  if (raw.type === 'system' && raw.subtype === 'init') {
    return {
      type: 'system',
      sessionId: raw.session_id,
      cwd: raw.cwd,
      model: raw.model,
    }
  }

  if (raw.type === 'assistant' && Array.isArray(raw.message?.content)) {
    for (const block of raw.message.content) {
      if (block.type === 'text') return { type: 'text', delta: block.text ?? '' }
      if (block.type === 'thinking') return { type: 'thinking', delta: block.thinking ?? '' }
      if (block.type === 'tool_use') {
        return { type: 'tool_use', id: block.id ?? '', name: block.name ?? 'tool', input: block.input ?? {} }
      }
    }
  }

  if (raw.type === 'user' && Array.isArray(raw.message?.content)) {
    for (const block of raw.message.content) {
      if (block.type === 'tool_result') {
        return {
          type: 'tool_result',
          id: block.tool_use_id ?? '',
          output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
          isError: Boolean(block.is_error),
        }
      }
    }
  }

  if (raw.type === 'result') {
    return {
      type: 'done',
      sessionId: raw.session_id,
      terminationReason: raw.is_error ? 'interrupted' : 'normal',
    }
  }

  if (raw.type === 'error') {
    return { type: 'error', message: raw.message ?? 'Claude failed', terminationReason: 'failed' }
  }

  return null
}

