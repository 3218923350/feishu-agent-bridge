import { describe, expect, it } from 'vitest'
import { initialRunState, reduceRunState } from '../../src/card/run-state.js'

describe('RunState reducer', () => {
  it('merges streaming text and closes it before a tool', () => {
    let state = reduceRunState(initialRunState, { type: 'text', delta: 'hello' })
    state = reduceRunState(state, { type: 'text', delta: ' world' })
    state = reduceRunState(state, { type: 'tool_use', id: 't1', name: 'Shell', input: { command: 'pwd' } })

    expect(state.blocks[0]).toEqual({ kind: 'text', content: 'hello world', streaming: false })
    expect(state.blocks[1]).toMatchObject({ kind: 'tool', tool: { id: 't1', status: 'running' } })
  })

  it('marks tool result as done', () => {
    let state = reduceRunState(initialRunState, { type: 'tool_use', id: 't1', name: 'Shell', input: {} })
    state = reduceRunState(state, { type: 'tool_result', id: 't1', output: 'ok', isError: false })

    expect(state.blocks[0]).toMatchObject({ kind: 'tool', tool: { status: 'done', output: 'ok' } })
  })
})

