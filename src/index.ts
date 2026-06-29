import * as Lark from '@larksuiteoapi/node-sdk'
import { createAdapters } from './agent/index.js'
import { loadConfig } from './config/store.js'
import { FeishuApi } from './connector/api.js'
import { extractCardAction, extractMessage, type InboundMessage } from './connector/events.js'
import { createWsClient } from './connector/websocket.js'
import { canUseBridge } from './policy/access.js'
import { AccessStore } from './policy/access-store.js'
import { PendingQueue } from './runtime/queue.js'
import { RunExecutor } from './runtime/run-executor.js'
import { SessionStore } from './session/store.js'
import { createThreadScope, type ThreadScope } from './session/thread-scope.js'
import { WorkspaceStore } from './workspace/store.js'
import { handleCommand } from './commands/router.js'
import { SingleOrchestrator } from './orchestrator/single.js'
import { ReviewOrchestrator } from './orchestrator/review.js'
import { DebateOrchestrator } from './orchestrator/debate.js'
import { RootAgentObserver } from './root-agent/observer.js'

export interface StartBridgeOptions {
  cwd?: string
}

export async function startBridge(options: StartBridgeOptions = {}): Promise<void> {
  const config = loadConfig()
  if (!config.feishu.app_id || !config.feishu.app_secret) {
    throw new Error('missing Feishu app_id/app_secret; run feishu-agent-bridge init')
  }

  const api = new FeishuApi(config.feishu)
  const botOpenId = await api.getBotOpenId().catch((error) => {
    console.error(`[feishu] bot info failed; group mention filtering disabled: ${error instanceof Error ? error.message : String(error)}`)
    return ''
  })
  const access = new AccessStore(config)
  const workspaces = new WorkspaceStore()
  const sessions = new SessionStore()
  const executor = new RunExecutor(config)
  const adapters = createAdapters()
  const claude = adapters.get('claude')!
  const codex = adapters.get('codex')!
  const single = new SingleOrchestrator(api, config, executor)
  const review = new ReviewOrchestrator(single, codex)
  const debate = new DebateOrchestrator(single, claude, codex)
  const rootAgent = new RootAgentObserver(config, api)
  const defaultCwd = options.cwd ?? process.cwd()
  const queue = new PendingQueue<InboundMessage>(600, (scopeId, batch) => {
    void processBatch(scopeId, batch)
  })

  const eventDispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data: any) => {
      const message = extractMessage(data, botOpenId)
      if (!message) return

      const security = await access.snapshot()
      if (!security.owner_open_id && message.chatType === 'p2p' && message.senderId) {
        await access.claimOwnerIfMissing(message.senderId)
        security.owner_open_id = message.senderId
        await api.replyText(message.messageId, '已将你设为 owner，之后可用 /invite user 或 /invite group 开放访问。')
      }
      const decision = canUseBridge(security, {
        senderId: message.senderId,
        chatId: message.chatId,
        chatType: message.chatType,
      })
      if (!decision.ok) {
        if (message.chatType === 'group' && message.mentionsBot) {
          await api.replyText(message.messageId, '这个群还没有开放，请让 owner/admin 执行 /invite group')
        }
        return
      }
      if (message.chatType === 'group' && security.require_mention_in_group && !message.mentionsBot && !message.threadId) {
        await rootAgent.observe(message, security)
        return
      }

      await ackMessage(message)

      const commandResult = await handleCommand(message, { api, access, workspaces, sessions, executor, defaultCwd })
      if (commandResult.handled) return

      const scopeId = scopeIdFor(message)
      if (message.text.startsWith('/review') || message.text.startsWith('/debate')) {
        await processBatch(scopeId, [message])
        return
      }

      queue.push(scopeId, message)
    },

    'card.action.trigger': async (data: any) => {
      const action = extractCardAction(data)
      if (!action) return {}
      if (action.action === 'stop' && typeof action.value.scopeId === 'string') {
        const active = executor.activeRuns.get(action.value.scopeId)
        if (active) {
          active.interrupted = true
          await active.run.stop()
          executor.activeRuns.unregister(action.value.scopeId, active.run)
        }
      }
      return {}
    },

    'im.message.message_read_v1': async () => {
      return {}
    },

    'im.message.reaction.created_v1': async () => {
      return {}
    },
  })

  async function ackMessage(message: InboundMessage): Promise<void> {
    const emoji = config.display.ack_reaction_emoji
    if (!emoji) return
    await api.reactToMessage(message.messageId, emoji).catch((error) => {
      console.error(`[feishu] ack reaction failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  async function processBatch(scopeId: string, batch: InboundMessage[]): Promise<void> {
    const first = batch[0]
    if (!first) return
    queue.block(scopeId)
    try {
      const text = batch.map((message) => message.text).join('\n')
      const scope = await ensureScope(first)
      if (text.startsWith('/review')) {
        const query = text.replace(/^\/review\s*/, '').trim() || 'Review the current work.'
        const next = await review.run(scope, query, first.threadId ?? first.messageId)
        await sessions.upsert(next)
        return
      }
      if (text.startsWith('/debate')) {
        const query = text.replace(/^\/debate\s*/, '').trim() || 'Debate the current task.'
        const next = await debate.run(scope, query, first.threadId ?? first.messageId, config.defaults.max_debate_rounds)
        await sessions.upsert(next)
        return
      }
      const mainTrack = await single.runTrack({
        scope,
        track: scope.mainTrack,
        agent: claude,
        prompt: text,
        replyToMessageId: first.threadId ?? first.messageId,
      })
      await sessions.upsert({ ...scope, mainTrack })
    } finally {
      queue.unblock(scopeId)
    }
  }

  async function ensureScope(message: InboundMessage): Promise<ThreadScope> {
    const threadId = message.threadId ?? message.messageId
    const scopeId = `${message.chatId}:${threadId}`
    const existing = await sessions.get(scopeId)
    if (existing) return existing
    const projectPath = message.chatType === 'group'
      ? await workspaces.groupPath(message.chatId) ?? defaultCwd
      : await workspaces.currentForUser(message.senderId, defaultCwd)
    const scope = createThreadScope({ chatId: message.chatId, threadId, projectPath })
    await sessions.upsert(scope)
    return scope
  }

  const wsClient = createWsClient(config)
  await wsClient.start({ eventDispatcher })

  console.error('feishu-agent-bridge started')
  console.error(`cwd: ${defaultCwd}`)
  console.error(`domain: ${config.feishu.domain}`)

  const shutdown = () => {
    for (const handle of executor.activeRuns.list()) {
      void handle.run.stop()
    }
    wsClient.close()
    setTimeout(() => process.exit(0), 300)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

function scopeIdFor(message: InboundMessage): string {
  return `${message.chatId}:${message.threadId ?? message.messageId}`
}
