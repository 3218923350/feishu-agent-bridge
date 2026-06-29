import type { AgentAdapter } from '../agent/types.js'
import type { ThreadScope } from '../session/thread-scope.js'
import { SingleOrchestrator } from './single.js'

const PREAMBLE = `You are in a two-agent debate. Engage deeply, disagree when useful, and converge only when the answer is genuinely strong.`

export class DebateOrchestrator {
  constructor(
    private readonly single: SingleOrchestrator,
    private readonly claude: AgentAdapter,
    private readonly codex: AgentAdapter,
  ) {}

  async run(scope: ThreadScope, query: string, replyToMessageId: string, maxRounds = 4): Promise<ThreadScope> {
    let current = scope
    const history: Array<{ agent: string; text: string }> = []
    for (let turn = 1; turn <= maxRounds; turn++) {
      const isClaude = turn % 2 === 1
      const agent = isClaude ? this.claude : this.codex
      const track = isClaude ? current.mainTrack : current.reviewTrack
      const prompt = buildPrompt(query, history, turn)
      const nextTrack = await this.single.runTrack({ scope: current, track, agent, prompt, replyToMessageId })
      history.push({ agent: agent.displayName, text: `Round ${turn} completed in session.` })
      current = isClaude ? { ...current, mainTrack: nextTrack } : { ...current, reviewTrack: nextTrack }
    }
    return current
  }
}

function buildPrompt(query: string, history: Array<{ agent: string; text: string }>, turn: number): string {
  const prior = history.map((item) => `${item.agent}: ${item.text}`).join('\n')
  return `${PREAMBLE}\n\nUser request:\n${query}\n\nPrior turns:\n${prior || '(none)'}\n\nTurn ${turn}: continue the debate.`
}
