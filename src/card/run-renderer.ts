import type { Block, RunState, ToolEntry } from './run-state.js'
import { toolBodyMd, toolHeaderText } from './tool-render.js'

const REASONING_MAX = 1500
const COLLAPSE_TOOL_THRESHOLD = 3

export interface RenderOptions {
  stopValue?: Record<string, unknown>
}

export function renderRunCard(state: RunState, opts: RenderOptions = {}): object {
  const elements: object[] = []

  if (state.reasoning.content) {
    elements.push(panel(state.reasoning.active ? 'Thinking' : 'Thinking complete', truncate(state.reasoning.content, REASONING_MAX), state.reasoning.active))
  }

  for (const group of groupBlocks(state.blocks)) {
    if (group.kind === 'text') elements.push({ tag: 'markdown', content: group.content })
    else elements.push(...renderTools(group.tools, state.terminal !== 'running'))
  }

  if (state.terminal === 'interrupted') elements.push(note('Stopped'))
  if (state.terminal === 'idle_timeout') elements.push(note('Stopped after idle timeout'))
  if (state.terminal === 'error') elements.push(note(`Agent failed: ${state.errorMsg ?? 'unknown error'}`))
  if (state.terminal === 'done' && elements.length === 0) elements.push(note('(no output)'))

  if (state.terminal === 'running') {
    if (state.footer) elements.push(note(summaryText(state)))
    elements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: 'Stop' },
      type: 'danger',
      behaviors: [{ type: 'callback', value: opts.stopValue ?? { cmd: 'stop' } }],
    })
  }

  return {
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: summaryText(state) },
    },
    body: { elements },
  }
}

function renderTools(tools: ToolEntry[], finalized: boolean): object[] {
  if (tools.length < COLLAPSE_TOOL_THRESHOLD) return tools.map((tool) => toolPanel(tool, !finalized && tool.status === 'running'))
  if (finalized) return [toolSummary(tools)]
  return [toolSummary(tools.slice(0, -1)), toolPanel(tools.at(-1)!, true)]
}

function toolPanel(tool: ToolEntry, expanded: boolean): object {
  return panel(toolHeaderText(tool), toolBodyMd(tool), expanded, tool.status === 'error' ? 'red' : 'grey')
}

function toolSummary(tools: ToolEntry[]): object {
  return panel(`${tools.length} tool calls`, tools.map((tool) => `- ${toolHeaderText(tool)}`).join('\n'), false, 'blue')
}

function panel(title: string, body: string, expanded: boolean, color = 'grey'): object {
  return {
    tag: 'collapsible_panel',
    expanded,
    header: { title: { tag: 'plain_text', content: title } },
    border: { color, corner_radius: '5px' },
    elements: [{ tag: 'markdown', content: body, text_size: 'notation' }],
  }
}

function note(content: string): object {
  return { tag: 'markdown', content, text_size: 'notation' }
}

function summaryText(state: RunState): string {
  if (state.terminal === 'done') return 'Done'
  if (state.terminal === 'error') return 'Failed'
  if (state.terminal === 'interrupted') return 'Stopped'
  if (state.footer === 'tool_running') return 'Running tool'
  if (state.footer === 'streaming') return 'Streaming'
  return 'Thinking'
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function* groupBlocks(blocks: Block[]): Generator<{ kind: 'text'; content: string } | { kind: 'tools'; tools: ToolEntry[] }> {
  let tools: ToolEntry[] = []
  for (const block of blocks) {
    if (block.kind === 'tool') {
      tools.push(block.tool)
    } else {
      if (tools.length) yield { kind: 'tools', tools }
      tools = []
      if (block.content.trim()) yield { kind: 'text', content: block.content }
    }
  }
  if (tools.length) yield { kind: 'tools', tools }
}

