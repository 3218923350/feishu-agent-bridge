import { access } from 'node:fs/promises'
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types.js'
import { parseNdjson } from '../ndjson.js'
import { spawnAgentProcess } from '../process.js'
import { normalizeClaudeEvent } from './stream-json.js'

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const
  readonly displayName = 'Claude Code'

  async isAvailable(): Promise<boolean> {
    return access('/usr/bin/env').then(() => true, () => false)
  }

  run(opts: AgentRunOptions): AgentRun {
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ]
    if (opts.model) args.push('--model', opts.model)
    if (opts.sessionId) args.push('--resume', opts.sessionId)
    if (opts.extraArgs) args.push(...opts.extraArgs)
    args.push(opts.prompt)

    const { proc, runBase } = spawnAgentProcess('claude', args, opts)

    return {
      ...runBase,
      events: mapClaudeEvents(parseNdjson(proc.stdout)),
    }
  }
}

async function* mapClaudeEvents(raws: AsyncIterable<any>): AsyncIterable<AgentEvent> {
  for await (const raw of raws) {
    const event = normalizeClaudeEvent(raw)
    if (event) yield event
  }
}

