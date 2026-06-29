import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { BridgeConfig } from '../../src/config/schema.js'
import { DEFAULT_CONFIG } from '../../src/config/schema.js'
import type { InboundMessage } from '../../src/connector/events.js'
import { RootAgentRuntime } from '../../src/root-agent/runtime.js'
import { ActivityStore, ContextSummaryStore, MemoryStore, ObserverInboxStore, RootPolicyStore, TodoStore, WorkOrderStore } from '../../src/root-agent/stores.js'
import { createThreadScope, type ThreadScope, type TrackState } from '../../src/session/thread-scope.js'

describe('RootAgentRuntime', () => {
  it('silently observes group messages, stores memory, and DMs the owner when attention is high', async () => {
    const runtime = await createRuntime()

    const decision = await runtime.root.handleSilentGroupMessage(message({
      mentionsBot: false,
      text: '王毅，这个开源项目需要你看一下。',
      senderId: 'ou_teammate',
    }), security())

    expect(decision?.action).toBe('dm_owner')
    expect(runtime.api.ownerTexts).toHaveLength(1)
    expect(runtime.api.ownerTexts[0]?.openId).toBe('ou_owner')
    expect(runtime.api.ownerTexts[0]?.content).toContain('你可能需要关注')
    expect(await runtime.root.inbox.readAll()).toHaveLength(1)
    expect(await runtime.root.memory.list()).toHaveLength(1)
    expect((await runtime.root.contexts.readAll())[0]?.summary).toContain('dm_owner')
  })

  it('honors per-chat silent observe policy overrides', async () => {
    const runtime = await createRuntime()

    await runtime.root.setSilentObserve('oc_test', false)
    const decision = await runtime.root.handleSilentGroupMessage(message({
      mentionsBot: false,
      text: '王毅，这个开源项目需要你看一下。',
      senderId: 'ou_teammate',
    }), security())

    expect(decision).toBeUndefined()
    expect(runtime.api.ownerTexts).toHaveLength(0)
    expect(await runtime.root.policyText('oc_test')).toContain('silent observe for this chat: off')
  })


  it('delegates addressed code work to Codex and persists the work order lifecycle', async () => {
    const runtime = await createRuntime()

    const handled = await runtime.root.handleAddressedMessage(message({
      text: '请帮我用 Codex 检查当前仓库测试。',
      mentionsBot: true,
    }), security())
    await flush()

    expect(handled).toBe(true)
    expect(runtime.single.calls).toHaveLength(1)
    expect(runtime.single.calls[0]?.agent.id).toBe('codex')
    expect(runtime.single.calls[0]?.prompt).toContain('Root Agent delegated work order')
    const orders = await runtime.root.workOrders.list()
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({ worker: 'codex', status: 'completed' })
    expect(runtime.sessions.scopes[0]?.reviewTrack.lastRunId).toBe('run-1')
  })

  it('keeps addressed conversational replies in the Root Agent session instead of falling through', async () => {
    const runtime = await createRuntime()

    const handled = await runtime.root.handleAddressedMessage(message({
      text: '你怎么看这个群里的推进节奏？',
      mentionsBot: true,
    }), security())

    expect(handled).toBe(true)
    expect(runtime.api.replies.at(-1)?.content).toContain('收到')
    expect(runtime.single.calls).toHaveLength(0)
  })
})

async function createRuntime() {
  const dir = await mkdtemp(join(tmpdir(), 'fab-root-'))
  const api = new FakeApi()
  const single = new FakeSingle()
  const sessions = new FakeSessions()
  const workspaces = new FakeWorkspaces(dir)
  const root = new RootAgentRuntime({
    config: config(),
    api: api as any,
    single: single as any,
    sessions: sessions as any,
    workspaces: workspaces as any,
    workers: {
      claude: { id: 'claude', displayName: 'Claude Code', isAvailable: async () => true, run: vi.fn() },
      codex: { id: 'codex', displayName: 'Codex', isAvailable: async () => true, run: vi.fn() },
    },
    defaultCwd: dir,
  }, {
    inbox: new ObserverInboxStore(join(dir, 'observer-inbox.jsonl')),
    activity: new ActivityStore(join(dir, 'activity.jsonl')),
    todos: new TodoStore(join(dir, 'todos.json')),
    workOrders: new WorkOrderStore(join(dir, 'work-orders.json')),
    memory: new MemoryStore(join(dir, 'memory-index.json')),
    contexts: new ContextSummaryStore(join(dir, 'context-summaries.jsonl')),
    policies: new RootPolicyStore(join(dir, 'root-policies.json')),
  })
  return { root, api, single, sessions }
}

function config(): BridgeConfig {
  return {
    ...DEFAULT_CONFIG,
    root_agent: {
      ...DEFAULT_CONFIG.root_agent,
      enabled: true,
      owner_aliases: ['王毅'],
      model: { ...DEFAULT_CONFIG.root_agent.model, provider: 'none' },
    },
    observe: {
      ...DEFAULT_CONFIG.observe,
      enabled: true,
      attention_keywords: ['开源'],
      dm_owner_when_attention_score_above: 0.5,
    },
    security: {
      ...DEFAULT_CONFIG.security,
      owner_open_id: 'ou_owner',
      allowed_chats: ['oc_test'],
      require_mention_in_group: true,
    },
  }
}

function security() {
  return {
    owner_open_id: 'ou_owner',
    allowed_users: [],
    allowed_chats: ['oc_test'],
    admins: [],
    require_mention_in_group: true,
  }
}

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    chatId: 'oc_test',
    chatType: 'group',
    messageId: `om_${Math.random().toString(36).slice(2, 8)}`,
    text: 'hello',
    senderId: 'ou_owner',
    mentionsBot: true,
    mentions: [],
    attachments: [],
    ...overrides,
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

class FakeApi {
  ownerTexts: Array<{ openId: string; content: string }> = []
  replies: Array<{ messageId: string; content: string }> = []

  async sendTextToOpenId(openId: string, content: string) {
    this.ownerTexts.push({ openId, content })
    return `dm-${this.ownerTexts.length}`
  }

  async replyText(messageId: string, content: string) {
    this.replies.push({ messageId, content })
    return `reply-${this.replies.length}`
  }
}

class FakeSingle {
  calls: Array<{ scope: ThreadScope; track: TrackState; agent: any; prompt: string; replyToMessageId: string }> = []

  async runTrack(input: { scope: ThreadScope; track: TrackState; agent: any; prompt: string; replyToMessageId: string }) {
    this.calls.push(input)
    return { ...input.track, lastRunId: `run-${this.calls.length}` }
  }
}

class FakeSessions {
  scopes: ThreadScope[] = []

  async get(scopeId: string) {
    return this.scopes.find((scope) => scope.scopeId === scopeId)
  }

  async upsert(scope: ThreadScope) {
    this.scopes = this.scopes.filter((item) => item.scopeId !== scope.scopeId)
    this.scopes.push(scope)
  }
}

class FakeWorkspaces {
  constructor(private readonly cwd: string) {}

  async groupPath() {
    return this.cwd
  }

  async currentForUser() {
    return this.cwd
  }
}
