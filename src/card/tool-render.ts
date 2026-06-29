import type { ToolEntry } from './run-state.js'

export function toolHeaderText(tool: ToolEntry): string {
  const icon = tool.status === 'running' ? 'Running' : tool.status === 'error' ? 'Failed' : 'Done'
  return `${icon} ${tool.name} - ${summarizeInput(tool.input)}`
}

export function toolBodyMd(tool: ToolEntry): string {
  const input = codeBlock(JSON.stringify(tool.input, null, 2).slice(0, 2500), 'json')
  const output = tool.output ? `\n\n${codeBlock(tool.output.slice(0, 2500), '')}` : ''
  return `${input}${output}`
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  if (obj.command) return String(obj.command).slice(0, 100)
  if (obj.file_path) return String(obj.file_path).slice(0, 100)
  return JSON.stringify(input).slice(0, 100)
}

function codeBlock(text: string, lang: string): string {
  return `\`\`\`${lang}\n${text}\n\`\`\``
}

