import { appPath } from '../core/paths.js'
import type { BridgeConfig } from '../config/schema.js'
import type { FeishuApi } from '../connector/api.js'
import type { InboundMessage } from '../connector/events.js'
import type { AccessState } from '../policy/access-store.js'
import { JsonlStore } from './jsonl-store.js'

export interface ObserverInboxRecord {
  id: string
  receivedAt: string
  chatId: string
  messageId: string
  threadId?: string
  senderId: string
  text: string
  mentions: Array<{ openId: string; name: string }>
}

export interface ActivityRecord {
  id: string
  time: string
  kind: 'observe' | 'dm-owner' | 'remember-only' | 'ignore'
  messageId: string
  chatId: string
  summary: string
}

export interface AttentionDecision {
  action: 'ignore' | 'remember_only' | 'dm_owner'
  score: number
  reason: string
  memoryCandidates: string[]
}

export interface RootAgentObserverOptions {
  inboxPath?: string
  activityPath?: string
  now?: () => Date
}

export class RootAgentObserver {
  private readonly inbox: JsonlStore<ObserverInboxRecord>
  private readonly activity: JsonlStore<ActivityRecord>
  private readonly now: () => Date
  private readonly ownerDmCounts = new Map<string, number>()

  constructor(
    private readonly config: BridgeConfig,
    private readonly api: Pick<FeishuApi, 'sendTextToOpenId'>,
    options: RootAgentObserverOptions = {},
  ) {
    this.inbox = new JsonlStore(options.inboxPath ?? appPath('observer-inbox.jsonl'))
    this.activity = new JsonlStore(options.activityPath ?? appPath('activity.jsonl'))
    this.now = options.now ?? (() => new Date())
  }

  enabled(): boolean {
    return this.config.root_agent.enabled &&
      this.config.observe.enabled &&
      this.config.observe.silent_group_observe
  }

  async observe(message: InboundMessage, security: AccessState): Promise<AttentionDecision | undefined> {
    if (!this.enabled()) return undefined
    if (message.chatType !== 'group' || message.mentionsBot || message.threadId) return undefined

    const ownerOpenId = this.ownerOpenId(security)
    const record = this.toInboxRecord(message)
    await this.inbox.append(record)

    let decision = this.classify(message, ownerOpenId)
    if (decision.action === 'dm_owner' && !this.reserveOwnerDm()) {
      decision = {
        action: 'remember_only',
        score: decision.score,
        reason: `${decision.reason}；已达到今日 owner 私聊提醒上限`,
        memoryCandidates: decision.memoryCandidates,
      }
    }
    await this.activity.append({
      id: `act_${record.id}`,
      time: record.receivedAt,
      kind: decision.action === 'dm_owner' ? 'dm-owner' : decision.action === 'remember_only' ? 'remember-only' : 'ignore',
      messageId: message.messageId,
      chatId: message.chatId,
      summary: decision.reason,
    })

    if (decision.action === 'dm_owner' && ownerOpenId) {
      await this.api.sendTextToOpenId(ownerOpenId, this.renderOwnerDm(message, decision)).catch((error) => {
        console.error(`[root-agent] owner dm failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    return decision
  }

  classify(message: InboundMessage, ownerOpenId: string): AttentionDecision {
    if (!message.text.trim()) return this.ignore('空消息或暂不支持的消息类型')
    if (ownerOpenId && message.senderId === ownerOpenId) return this.rememberOnly('owner 自己发的群消息，只记录不提醒')

    const ownerAliases = this.config.root_agent.owner_aliases.map((alias) => alias.trim()).filter(Boolean)
    const keywords = this.config.observe.attention_keywords.map((keyword) => keyword.trim()).filter(Boolean)
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
    if (score >= this.config.observe.dm_owner_when_attention_score_above) {
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

  private ownerOpenId(security: AccessState): string {
    return this.config.root_agent.owner_open_id || security.owner_open_id || this.config.security.owner_open_id
  }

  private toInboxRecord(message: InboundMessage): ObserverInboxRecord {
    const now = this.now()
    return {
      id: `${message.messageId}_${now.getTime()}`,
      receivedAt: now.toISOString(),
      chatId: message.chatId,
      messageId: message.messageId,
      threadId: message.threadId,
      senderId: message.senderId,
      text: message.text,
      mentions: message.mentions,
    }
  }

  private renderOwnerDm(message: InboundMessage, decision: AttentionDecision): string {
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

  private ignore(reason: string): AttentionDecision {
    return { action: 'ignore', score: 0, reason, memoryCandidates: [] }
  }

  private rememberOnly(reason: string): AttentionDecision {
    return { action: 'remember_only', score: 0.1, reason, memoryCandidates: [] }
  }

  private reserveOwnerDm(): boolean {
    const today = this.now().toISOString().slice(0, 10)
    const count = this.ownerDmCounts.get(today) ?? 0
    if (count >= this.config.observe.max_owner_dm_per_day) return false
    this.ownerDmCounts.set(today, count + 1)
    return true
  }
}
