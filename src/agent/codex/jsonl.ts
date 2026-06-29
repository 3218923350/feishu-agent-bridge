import type { AgentEvent } from '../types.js'

export function normalizeCodexEvent(raw: any): AgentEvent | null {
  switch (raw.type) {
    case 'thread.started':
      return { type: 'system', threadId: raw.thread_id ?? raw.threadId }

    case 'item.started': {
      const item = raw.item
      if (!item) return null
      if (item.type === 'command_execution') {
        return {
          type: 'tool_use',
          id: item.id ?? '',
          name: 'Shell',
          input: { command: item.command ?? '' },
        }
      }
      if (item.type === 'file_edit') {
        return {
          type: 'tool_use',
          id: item.id ?? '',
          name: 'Edit',
          input: { file_path: item.file_path ?? '' },
        }
      }
      return null
    }

    case 'item.completed': {
      const item = raw.item
      if (!item) return null
      if (item.type === 'agent_message') return { type: 'text', delta: item.text ?? '' }
      if (item.type === 'command_execution') {
        return {
          type: 'tool_result',
          id: item.id ?? '',
          output: item.aggregated_output ?? '',
          isError: item.exit_code !== 0,
        }
      }
      if (item.type === 'file_edit') {
        return {
          type: 'tool_result',
          id: item.id ?? '',
          output: item.file_path ? `Edited: ${item.file_path}` : '',
          isError: false,
        }
      }
      return null
    }

    case 'turn.completed':
      return {
        type: 'done',
        threadId: raw.thread_id ?? raw.threadId,
        terminationReason: 'normal',
      }

    case 'turn.failed':
      return {
        type: 'error',
        message: raw.error?.message ?? 'Codex turn failed',
        terminationReason: 'failed',
      }

    case 'error':
      return { type: 'error', message: raw.message ?? 'Codex failed', terminationReason: 'failed' }

    default:
      return null
  }
}

