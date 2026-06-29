import type { AgentAdapter } from '../agent/types.js'
import type { BridgeConfig } from '../config/schema.js'
import type { FeishuApi } from '../connector/api.js'
import type { InboundMessage } from '../connector/events.js'
import type { SingleOrchestrator } from '../orchestrator/single.js'
import type { AccessState } from '../policy/access-store.js'
import { createThreadScope } from '../session/thread-scope.js'
import type { SessionStore } from '../session/store.js'
import type { WorkspaceStore } from '../workspace/store.js'
import { createRootModel, type RootModel } from './model.js'
import { ActivityStore, ContextSummaryStore, MemoryStore, ObserverInboxStore, RootPolicyStore, TodoStore, WorkOrderStore } from './stores.js'
import type { ActivityRecord, ContextSummary, ObserverInboxRecord, RootDecision, RootTodo, WorkerKind, WorkOrder } from './types.js'

export interface RootAgentRuntimeOptions {
  model?: RootModel
  inbox?: ObserverInboxStore
  activity?: ActivityStore
  todos?: TodoStore
  workOrders?: WorkOrderStore
  memory?: MemoryStore
  contexts?: ContextSummaryStore
  policies?: RootPolicyStore
  now?: () => Date
}

export interface RootAgentRuntimeDeps {
  config: BridgeConfig
  api: Pick<FeishuApi, 'sendTextToOpenId' | 'replyText'>
  single: SingleOrchestrator
  sessions: SessionStore
  workspaces: WorkspaceStore
  workers: Record<WorkerKind, AgentAdapter>
  defaultCwd: string
}

export class RootAgentRuntime {
  readonly inbox: ObserverInboxStore
  readonly activity: ActivityStore
  readonly todos: TodoStore
  readonly workOrders: WorkOrderStore
  readonly memory: MemoryStore
  readonly contexts: ContextSummaryStore
  readonly policies: RootPolicyStore
  private readonly model: RootModel
  private readonly now: () => Date
  private readonly ownerDmCounts = new Map<string, number>()
  private scheduler?: NodeJS.Timeout

  constructor(private readonly deps: RootAgentRuntimeDeps, options: RootAgentRuntimeOptions = {}) {
    this.inbox = options.inbox ?? new ObserverInboxStore()
    this.activity = options.activity ?? new ActivityStore()
    this.todos = options.todos ?? new TodoStore()
    this.workOrders = options.workOrders ?? new WorkOrderStore()
    this.memory = options.memory ?? new MemoryStore()
    this.contexts = options.contexts ?? new ContextSummaryStore()
    this.policies = options.policies ?? new RootPolicyStore()
    this.model = options.model ?? createRootModel(deps.config)
    this.now = options.now ?? (() => new Date())
  }

  enabled(): boolean {
    return this.deps.config.root_agent.enabled
  }

  startScheduler(): void {
    if (!this.enabled() || this.scheduler) return
    this.scheduler = setInterval(() => {
      void this.processDueTodos()
    }, 30_000)
    this.scheduler.unref?.()
  }

  stopScheduler(): void {
    if (!this.scheduler) return
    clearInterval(this.scheduler)
    this.scheduler = undefined
  }

  async handleSilentGroupMessage(message: InboundMessage, security: AccessState): Promise<RootDecision | undefined> {
    if (!this.enabled() || !this.deps.config.observe.enabled || !this.deps.config.observe.silent_group_observe) return undefined
    if (message.chatType !== 'group' || message.mentionsBot || message.threadId) return undefined
    if (!await this.silentObserveEnabled(message.chatId)) return undefined
    return this.handleMessage(message, security, false)
  }

  async setSilentObserve(chatId: string, enabled: boolean): Promise<void> {
    await this.policies.setChatPolicy(chatId, { silentObserve: enabled })
  }

  async policyText(chatId: string): Promise<string> {
    const policy = await this.policies.get(chatId)
    const silentObserve = policy?.silentObserve ?? this.deps.config.observe.silent_group_observe
    return [
      `root agent enabled: ${this.enabled()}`,
      `global observe enabled: ${this.deps.config.observe.enabled}`,
      `silent observe for this chat: ${silentObserve ? 'on' : 'off'}`,
      `owner dm threshold: ${this.deps.config.observe.dm_owner_when_attention_score_above}`,
      `owner dm daily cap: ${this.deps.config.observe.max_owner_dm_per_day}`,
      `attention keywords: ${this.deps.config.observe.attention_keywords.join(', ') || '(none)'}`,
    ].join('\n')
  }

  async handleAddressedMessage(message: InboundMessage, security: AccessState): Promise<boolean> {
    if (!this.enabled()) return false
    const decision = await this.handleMessage(message, security, true)
    return Boolean(decision && decision.action !== 'ignore')
  }

  async delegate(input: {
    message: InboundMessage
    security: AccessState
    worker: WorkerKind
    task: string
    expectedOutput?: string
  }): Promise<WorkOrder> {
    const ownerOpenId = this.ownerOpenId(input.security)
    const workspace = input.message.chatType === 'group'
      ? await this.deps.workspaces.groupPath(input.message.chatId) ?? this.deps.defaultCwd
      : await this.deps.workspaces.currentForUser(input.message.senderId, this.deps.defaultCwd)
    const order = await this.workOrders.create({
      source: {
        chatId: input.message.chatId,
        messageId: input.message.messageId,
        threadId: input.message.threadId,
      },
      ownerOpenId,
      worker: input.worker,
      workspace,
      task: input.task,
      expectedOutput: input.expectedOutput || '完成任务并给出结论、风险、验证方式。',
    })
    await this.recordActivity('delegate', `创建 work order ${order.id}: ${order.task}`, input.message)
    void this.runWorkOrder(order, input.message)
    return order
  }

  async statusText(): Promise<string> {
    const [todos, orders, memories, activities] = await Promise.all([
      this.todos.list(),
      this.workOrders.list(),
      this.memory.list(),
      this.activity.tail(5),
    ])
    return [
      `root agent: ${this.enabled() ? 'enabled' : 'disabled'}`,
      `pending todos: ${todos.filter((todo) => todo.status === 'pending').length}`,
      `active work orders: ${orders.filter((order) => order.status === 'pending' || order.status === 'running').length}`,
      `memories: ${memories.length}`,
      '',
      'recent activity:',
      ...(activities.length ? activities.map((item) => `- ${item.time} ${item.kind}: ${item.summary}`) : ['- none']),
    ].join('\n')
  }

  private async handleMessage(message: InboundMessage, security: AccessState, addressed: boolean): Promise<RootDecision | undefined> {
    const ownerOpenId = this.ownerOpenId(security)
    const inboxRecord = await this.writeInbox(message, addressed)
    const decision = await this.decide(message, security, addressed)
    const finalDecision = decision.action === 'dm_owner' && !this.reserveOwnerDm()
      ? { ...decision, action: 'remember_only' as const, reason: `${decision.reason}；已达到今日 owner 私聊提醒上限` }
      : decision

    await this.applyMemoryCandidates(finalDecision, inboxRecord)
    if (finalDecision.todo) {
      await this.todos.add({
        text: finalDecision.todo.text,
        at: finalDecision.todo.at,
        source: { chatId: message.chatId, messageId: message.messageId },
      })
      await this.recordActivity('todo', `创建 TODO: ${finalDecision.todo.text}`, message)
    }

    if (finalDecision.action === 'dm_owner' && ownerOpenId) {
      await this.deps.api.sendTextToOpenId(ownerOpenId, this.renderOwnerDm(message, finalDecision)).catch((error) => {
        console.error(`[root-agent] owner dm failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      await this.recordActivity('dm-owner', finalDecision.reason, message)
    } else if (finalDecision.action === 'reply' && addressed && finalDecision.reply) {
      await this.deps.api.replyText(message.threadId ?? message.messageId, finalDecision.reply)
      await this.recordActivity('reply', finalDecision.reason || finalDecision.reply.slice(0, 80), message)
    } else if (finalDecision.action === 'delegate' && finalDecision.delegate) {
      await this.delegate({
        message,
        security,
        worker: finalDecision.delegate.worker,
        task: finalDecision.delegate.task || message.text,
        expectedOutput: finalDecision.delegate.expectedOutput,
      })
    } else {
      await this.recordActivity(finalDecision.action === 'remember_only' ? 'remember-only' : 'ignore', finalDecision.reason, message)
    }

    await this.writeContextSummary(message, finalDecision, inboxRecord)
    return finalDecision
  }

  private async decide(message: InboundMessage, security: AccessState, addressed: boolean): Promise<RootDecision> {
    const rule = this.ruleDecision(message, security, addressed)
    if (this.deps.config.root_agent.model.provider === 'none') return rule
    try {
      return await this.model.decide(await this.buildDecisionPrompt(message, security, addressed, rule))
    } catch (error) {
      console.error(`[root-agent] model decision failed, fallback to rules: ${error instanceof Error ? error.message : String(error)}`)
      return rule
    }
  }

  private ruleDecision(message: InboundMessage, security: AccessState, addressed: boolean): RootDecision {
    if (addressed) {
      const text = message.text.toLowerCase()
      if (/codex|review|检查|审查|修复|实现|代码|仓库/.test(text)) {
        return {
          action: 'delegate',
          score: 0.9,
          reason: '被 @ 的消息看起来需要代码执行或审查，委派给 Codex',
          delegate: { worker: 'codex', task: message.text, expectedOutput: '给出执行结果、风险和验证方式。' },
          memoryCandidates: [],
        }
      }
      if (/claude|文档|整理|方案|解释|设计/.test(text)) {
        return {
          action: 'delegate',
          score: 0.85,
          reason: '被 @ 的消息看起来需要方案或文档产出，委派给 Claude Code',
          delegate: { worker: 'claude', task: message.text, expectedOutput: '给出清晰方案或文档产出。' },
          memoryCandidates: [],
        }
      }
      return {
        action: 'reply',
        score: 0.7,
        reason: '被 @，Root Agent 直接简短回应',
        reply: '收到，我先看一下。需要动代码或深入执行时我会转给 Codex/Claude Code。',
        memoryCandidates: [],
      }
    }

    if (!message.text.trim()) return this.ignore('空消息或暂不支持的消息类型')
    const ownerOpenId = this.ownerOpenId(security)
    if (ownerOpenId && message.senderId === ownerOpenId) return this.rememberOnly('owner 自己发的群消息，只记录不提醒')

    const ownerAliases = this.deps.config.root_agent.owner_aliases.map((alias) => alias.trim()).filter(Boolean)
    const keywords = this.deps.config.observe.attention_keywords.map((keyword) => keyword.trim()).filter(Boolean)
    const mentionedOwner = Boolean(ownerOpenId && message.mentions.some((mention) => mention.openId === ownerOpenId))
    const matchedAlias = ownerAliases.find((alias) => message.text.includes(alias) || message.mentions.some((mention) => mention.name.includes(alias)))
    const matchedKeyword = keywords.find((keyword) => message.text.includes(keyword))
    let score = 0
    const reasons: string[] = []
    if (mentionedOwner) {
      score += 0.7
      reasons.push('消息 @ 了 owner')
    }
    if (matchedAlias) {
      score += 0.5
      reasons.push(`消息提到了 owner 别名「${matchedAlias}」`)
    }
    if (matchedKeyword) {
      score += 0.35
      reasons.push(`命中关注关键词「${matchedKeyword}」`)
    }
    score = Math.min(1, score)
    if (score >= this.deps.config.observe.dm_owner_when_attention_score_above) {
      return {
        action: 'dm_owner',
        score,
        reason: reasons.join('；') || '判断需要 owner 关注',
        memoryCandidates: [message.text.slice(0, 200)].filter(Boolean),
      }
    }
    if (score > 0) {
      return {
        action: 'remember_only',
        score,
        reason: reasons.join('；'),
        memoryCandidates: [message.text.slice(0, 200)].filter(Boolean),
      }
    }
    return this.ignore('未命中 owner、关注关键词或显式委派信号')
  }

  private async buildDecisionPrompt(message: InboundMessage, security: AccessState, addressed: boolean, fallback: RootDecision): Promise<string> {
    const memories = await this.memory.search(message.text, 6)
    const summaries = await this.contexts.relevant(`${message.chatId}:${message.threadId ?? message.messageId}`, 4)
    return [
      'You are Root Agent, an always-on personal employee agent in Feishu.',
      'Return strict JSON only. Schema: {"action":"ignore|remember_only|dm_owner|reply|delegate","score":0-1,"reason":"...","reply":"optional","delegate":{"worker":"codex|claude","task":"...","expectedOutput":"..."},"memoryCandidates":["..."],"todo":{"text":"...","at":"ISO time"}}',
      `Addressed by @ bot: ${addressed}`,
      `Owner open_id: ${this.ownerOpenId(security)}`,
      '',
      'Recent relevant memories:',
      memories.map((memory) => `- ${memory.path}: ${memory.abstract}`).join('\n') || '(none)',
      '',
      'Relevant context summaries:',
      summaries.map((summary) => `- ${summary.summary}`).join('\n') || '(none)',
      '',
      'Fallback rule decision:',
      JSON.stringify(fallback),
      '',
      'Message:',
      message.text,
    ].join('\n')
  }

  private async runWorkOrder(order: WorkOrder, sourceMessage: InboundMessage): Promise<void> {
    await this.workOrders.update(order.id, { status: 'running' })
    try {
      const threadId = sourceMessage.threadId ?? sourceMessage.messageId
      const scopeId = `${sourceMessage.chatId}:${threadId}`
      const existing = await this.deps.sessions.get(scopeId)
      const scope = existing ?? createThreadScope({ chatId: sourceMessage.chatId, threadId, projectPath: order.workspace })
      const track = order.worker === 'codex' ? scope.reviewTrack : scope.mainTrack
      const nextTrack = await this.deps.single.runTrack({
        scope,
        track,
        agent: this.deps.workers[order.worker],
        prompt: this.workOrderPrompt(order),
        replyToMessageId: sourceMessage.threadId ?? sourceMessage.messageId,
      })
      await this.deps.sessions.upsert(order.worker === 'codex' ? { ...scope, reviewTrack: nextTrack } : { ...scope, mainTrack: nextTrack })
      await this.workOrders.update(order.id, { status: 'completed', result: `worker ${order.worker} completed` })
      await this.recordActivity('delegate', `work order ${order.id} completed`, sourceMessage)
    } catch (error) {
      await this.workOrders.update(order.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
      await this.recordActivity('delegate', `work order ${order.id} failed: ${error instanceof Error ? error.message : String(error)}`, sourceMessage)
    }
  }

  private workOrderPrompt(order: WorkOrder): string {
    return [
      `Root Agent delegated work order ${order.id}.`,
      `Task: ${order.task}`,
      `Expected output: ${order.expectedOutput}`,
      '',
      'Return useful progress and final conclusions. Mention risks and verification steps.',
    ].join('\n')
  }

  private async writeInbox(message: InboundMessage, addressed: boolean): Promise<ObserverInboxRecord> {
    const now = this.now()
    const record: ObserverInboxRecord = {
      id: `${message.messageId}_${now.getTime()}`,
      receivedAt: now.toISOString(),
      chatId: message.chatId,
      messageId: message.messageId,
      threadId: message.threadId,
      senderId: message.senderId,
      text: message.text,
      mentions: message.mentions,
      addressed,
    }
    await this.inbox.append(record)
    return record
  }

  private async applyMemoryCandidates(decision: RootDecision, inbox: ObserverInboxRecord): Promise<void> {
    for (const candidate of decision.memoryCandidates) {
      await this.memory.add({
        path: `04_Episodes/${inbox.receivedAt.slice(0, 10)}`,
        abstract: candidate.slice(0, 200),
        overview: candidate,
        tags: ['auto-extracted'],
        sourceIds: [inbox.messageId],
        confidence: 'hypothesis',
      })
    }
  }

  private async writeContextSummary(message: InboundMessage, decision: RootDecision, inbox: ObserverInboxRecord): Promise<void> {
    const summary: ContextSummary = {
      id: `ctx_${inbox.id}`,
      createdAt: this.now().toISOString(),
      kind: 'event_summary',
      scopeId: `${message.chatId}:${message.threadId ?? message.messageId}`,
      sourceIds: [message.messageId],
      summary: `${decision.action}: ${decision.reason}`,
      facts: decision.memoryCandidates,
      openLoops: decision.todo ? [decision.todo.text] : [],
      memoryRefs: [],
    }
    await this.contexts.append(summary)
    await this.recordActivity('context', summary.summary, message)
  }

  private async processDueTodos(): Promise<void> {
    const due = await this.todos.due(this.now())
    const ownerOpenId = this.deps.config.root_agent.owner_open_id || this.deps.config.security.owner_open_id
    for (const todo of due) {
      await this.todos.update(todo.id, { status: 'claimed' })
      if (ownerOpenId) {
        await this.deps.api.sendTextToOpenId(ownerOpenId, [
          `Root Agent TODO 到期：${todo.text}`,
          `TODO: ${todo.id}`,
          `计划时间: ${todo.at}`,
        ].join('\n')).catch((error) => {
          console.error(`[root-agent] todo dm failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
      await this.activity.append({
        id: `act_${todo.id}`,
        time: this.now().toISOString(),
        kind: 'todo',
        summary: `TODO due: ${todo.text}`,
      })
    }
  }

  private async silentObserveEnabled(chatId: string): Promise<boolean> {
    const policy = await this.policies.get(chatId)
    return policy?.silentObserve ?? true
  }

  private ownerOpenId(security: AccessState): string {
    return this.deps.config.root_agent.owner_open_id || security.owner_open_id || this.deps.config.security.owner_open_id
  }

  private renderOwnerDm(message: InboundMessage, decision: RootDecision): string {
    return [
      '我觉得这条群消息你可能需要关注：',
      '',
      `原因：${decision.reason}`,
      `相关度：${decision.score.toFixed(2)}`,
      `来源 chat：${message.chatId}`,
      `消息 ID：${message.messageId}`,
      '',
      message.text,
    ].join('\n')
  }

  private async recordActivity(kind: ActivityRecord['kind'], summary: string, message?: InboundMessage): Promise<void> {
    await this.activity.append({
      id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      time: this.now().toISOString(),
      kind,
      messageId: message?.messageId,
      chatId: message?.chatId,
      summary,
    })
  }

  private reserveOwnerDm(): boolean {
    const today = this.now().toISOString().slice(0, 10)
    const count = this.ownerDmCounts.get(today) ?? 0
    if (count >= this.deps.config.observe.max_owner_dm_per_day) return false
    this.ownerDmCounts.set(today, count + 1)
    return true
  }

  private ignore(reason: string): RootDecision {
    return { action: 'ignore', score: 0, reason, memoryCandidates: [] }
  }

  private rememberOnly(reason: string): RootDecision {
    return { action: 'remember_only', score: 0.1, reason, memoryCandidates: [] }
  }
}
