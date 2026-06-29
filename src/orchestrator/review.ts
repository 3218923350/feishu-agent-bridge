import type { AgentAdapter } from '../agent/types.js'
import type { ThreadScope } from '../session/thread-scope.js'
import { SingleOrchestrator } from './single.js'

export class ReviewOrchestrator {
  constructor(
    private readonly single: SingleOrchestrator,
    private readonly codex: AgentAdapter,
  ) {}

  async run(scope: ThreadScope, query: string, replyToMessageId: string): Promise<ThreadScope> {
    const prompt = [
      'Review the current repository and the active task context.',
      'Do not rely on a copied transcript from the bridge; use your own session and filesystem inspection.',
      '',
      query,
    ].join('\n')
    const reviewTrack = await this.single.runTrack({
      scope,
      track: scope.reviewTrack,
      agent: this.codex,
      prompt,
      replyToMessageId,
    })
    return { ...scope, reviewTrack }
  }
}

