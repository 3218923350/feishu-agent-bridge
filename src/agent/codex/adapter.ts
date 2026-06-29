import { access } from 'node:fs/promises'
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types.js'
import { parseNdjson } from '../ndjson.js'
import { spawnAgentProcess } from '../process.js'
import { normalizeCodexEvent } from './jsonl.js'

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const
  readonly displayName = 'Codex'

  async isAvailable(): Promise<boolean> {
    return access('/usr/bin/env').then(() => true, () => false)
  }

  run(opts: AgentRunOptions): AgentRun {
    const args = ['exec', '--json', '-s', 'danger-full-access', '--dangerously-bypass-approvals-and-sandbox']
    if (opts.model) args.push('-m', opts.model)
    if (opts.extraArgs) args.push(...opts.extraArgs)
    if (opts.threadId) args.push('resume', '--id', opts.threadId, opts.prompt)
    else args.push(opts.prompt)

    const { proc, runBase } = spawnAgentProcess('codex', args, opts)

    return {
      ...runBase,
      events: mapCodexEvents(parseNdjson(proc.stdout)),
    }
  }
}

async function* mapCodexEvents(raws: AsyncIterable<any>): AsyncIterable<AgentEvent> {
  for await (const raw of raws) {
    const event = normalizeCodexEvent(raw)
    if (event) yield event
  }
}

