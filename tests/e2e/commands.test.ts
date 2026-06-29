import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { handleCommand, type CommandContext } from '../../src/commands/router.js'
import type { InboundMessage } from '../../src/connector/events.js'
import { DebateOrchestrator } from '../../src/orchestrator/debate.js'
import { ReviewOrchestrator } from '../../src/orchestrator/review.js'
import { createThreadScope, type ThreadScope, type TrackState } from '../../src/session/thread-scope.js'

describe('Feishu command E2E routing', () => {
  it('handles help, status, new, stop, cd, ls, workspace, invite, and remove commands', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fab-e2e-'))
    const api = new FakeApi()
    const activeRuns = new FakeActiveRuns()
    const ctx = createContext({ api, activeRuns, defaultCwd: cwd })

    await route('/help', ctx)
    expect(api.cards.at(-1)?.card).toMatchObject({ header: { title: { content: 'feishu-agent-bridge' } } })

    await route('/ls', ctx)
    expect(api.texts.at(-1)?.content).toBe(`当前目录: ${cwd}`)

    await route(`/cd ${cwd}`, ctx)
    expect(api.texts.at(-1)?.content).toBe(`当前导航目录: ${cwd}`)

    await route('/ws save main', ctx)
    expect(api.texts.at(-1)?.content).toBe(`已保存工作区 main: ${cwd}`)

    await route('/ws list', ctx)
    expect(api.texts.at(-1)?.content).toBe(`main: ${cwd}`)

    await route('/ws use main', ctx)
    expect(api.texts.at(-1)?.content).toBe(`已切换工作区 main: ${cwd}`)

    await route('/ws remove main', ctx)
    expect(api.texts.at(-1)?.content).toBe('已删除工作区: main')

    await route('/invite user ou_user', ctx)
    await route('/invite admin ou_admin', ctx)
    await route('/invite group', ctx)
    expect(ctx.access.state.allowed_users).toEqual(['ou_user'])
    expect(ctx.access.state.admins).toEqual(['ou_admin'])
    expect(ctx.access.state.allowed_chats).toEqual(['oc_test'])

    await route('/remove user ou_user', ctx)
    await route('/remove admin ou_admin', ctx)
    await route('/remove group', ctx)
    expect(ctx.access.state.allowed_users).toEqual([])
    expect(ctx.access.state.admins).toEqual([])
    expect(ctx.access.state.allowed_chats).toEqual([])

    const run = { stop: vi.fn(async () => {}) }
    activeRuns.set('oc_test:om_test', run)
    await route('/stop', ctx)
    expect(run.stop).toHaveBeenCalledTimes(1)
    expect(api.texts.at(-1)?.content).toBe('已停止当前任务')

    activeRuns.set('oc_test:om_test', { stop: vi.fn(async () => {}) })
    await route('/new', ctx)
    expect(api.texts.at(-1)?.content).toBe('已重置当前话题 session')
    expect(activeRuns.get('oc_test:om_test')).toBeUndefined()

    await route('/status', ctx)
    expect(api.cards.at(-1)?.card).toMatchObject({ header: { title: { content: 'Status' } } })
  })

  it('handles private-only and group-specific commands', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fab-e2e-'))
    const api = new FakeApi()
    const activeRuns = new FakeActiveRuns()
    const ctx = createContext({ api, activeRuns, defaultCwd: cwd })

    await route('/new chat demo-project', ctx, { chatType: 'p2p' })
    expect(api.createdGroups).toEqual([{ name: 'demo-project', userOpenIds: ['ou_owner'] }])
    expect(ctx.workspaces.groups.oc_created.path).toBe(cwd)
    expect(api.texts.at(-1)?.content).toBe(`已创建项目群 demo-project\n路径: ${cwd}`)

    await route('/cd /tmp', ctx, { chatType: 'group' })
    expect(api.texts.at(-1)?.content).toBe('群路径不可修改，请回 bot 私聊执行 /cd')

    await route('/ws use missing', ctx, { chatType: 'group' })
    expect(api.texts.at(-1)?.content).toBe('群路径不可修改，请回 bot 私聊执行 /ws use')
  })
})

describe('review and debate E2E orchestration', () => {
  it('runs review on the Codex review track', async () => {
    const single = new FakeSingle()
    const codex = { id: 'codex' as const, displayName: 'Codex', isAvailable: async () => true, run: vi.fn() }
    const scope = createThreadScope({ chatId: 'oc_test', threadId: 'om_test', projectPath: '/tmp' })
    const review = new ReviewOrchestrator(single as any, codex)

    const next = await review.run(scope, '检查权限问题', 'om_reply')

    expect(single.calls).toHaveLength(1)
    expect(single.calls[0]).toMatchObject({ agent: codex, replyToMessageId: 'om_reply' })
    expect(single.calls[0].track).toEqual(scope.reviewTrack)
    expect(single.calls[0].prompt).toContain('Review the current repository')
    expect(single.calls[0].prompt).toContain('检查权限问题')
    expect(next.reviewTrack.lastRunId).toBe('run-1')
  })

  it('alternates Claude and Codex tracks in debate mode', async () => {
    const single = new FakeSingle()
    const claude = { id: 'claude' as const, displayName: 'Claude Code', isAvailable: async () => true, run: vi.fn() }
    const codex = { id: 'codex' as const, displayName: 'Codex', isAvailable: async () => true, run: vi.fn() }
    const scope = createThreadScope({ chatId: 'oc_test', threadId: 'om_test', projectPath: '/tmp' })
    const debate = new DebateOrchestrator(single as any, claude, codex)

    const next = await debate.run(scope, '讨论常驻方案', 'om_reply', 4)

    expect(single.calls.map((call) => call.agent.displayName)).toEqual(['Claude Code', 'Codex', 'Claude Code', 'Codex'])
    expect(single.calls.map((call) => call.track.agentId)).toEqual(['claude', 'codex', 'claude', 'codex'])
    expect(single.calls[0].prompt).toContain('two-agent debate')
    expect(single.calls[0].prompt).toContain('讨论常驻方案')
    expect(next.mainTrack.lastRunId).toBe('run-3')
    expect(next.reviewTrack.lastRunId).toBe('run-4')
  })
})

async function route(text: string, ctx: TestContext, overrides: Partial<InboundMessage> = {}) {
  return handleCommand(message(text, overrides), ctx as unknown as CommandContext)
}

function message(text: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    chatId: 'oc_test',
    chatType: 'p2p',
    messageId: 'om_test',
    text,
    senderId: 'ou_owner',
    mentionsBot: true,
    attachments: [],
    ...overrides,
  }
}

function createContext(input: { api: FakeApi; activeRuns: FakeActiveRuns; defaultCwd: string }): TestContext {
  return {
    api: input.api,
    access: new FakeAccess(),
    workspaces: new FakeWorkspaces(input.defaultCwd),
    sessions: new FakeSessions(),
    executor: { activeRuns: input.activeRuns },
    defaultCwd: input.defaultCwd,
  }
}

interface TestContext {
  api: FakeApi
  access: FakeAccess
  workspaces: FakeWorkspaces
  sessions: FakeSessions
  executor: { activeRuns: FakeActiveRuns }
  defaultCwd: string
}

class FakeApi {
  texts: Array<{ messageId: string; content: string }> = []
  cards: Array<{ messageId: string; card: any }> = []
  createdGroups: Array<{ name: string; userOpenIds: string[] }> = []

  async replyText(messageId: string, content: string) {
    this.texts.push({ messageId, content })
    return `reply-${this.texts.length}`
  }

  async replyCard(messageId: string, card: object) {
    this.cards.push({ messageId, card })
    return `card-${this.cards.length}`
  }

  async createGroup(name: string, userOpenIds: string[]) {
    this.createdGroups.push({ name, userOpenIds })
    return 'oc_created'
  }

  async reactToMessage() {}
}

class FakeAccess {
  state = {
    owner_open_id: 'ou_owner',
    allowed_users: [] as string[],
    allowed_chats: [] as string[],
    admins: [] as string[],
    require_mention_in_group: true,
  }

  async snapshot() {
    return this.state
  }

  async addUser(id: string) {
    this.state.allowed_users.push(id)
  }

  async addChat(id: string) {
    this.state.allowed_chats.push(id)
  }

  async addAdmin(id: string) {
    this.state.admins.push(id)
  }

  async removeUser(id: string) {
    this.state.allowed_users = this.state.allowed_users.filter((value) => value !== id)
  }

  async removeChat(id: string) {
    this.state.allowed_chats = this.state.allowed_chats.filter((value) => value !== id)
  }

  async removeAdmin(id: string) {
    this.state.admins = this.state.admins.filter((value) => value !== id)
  }
}

class FakeWorkspaces {
  currentByUser: Record<string, string> = {}
  named: Record<string, string> = {}
  groups: Record<string, { path: string; name: string; createdAt: string }> = {}

  constructor(private readonly fallback: string) {}

  async currentForUser(userId: string, fallback: string) {
    return this.currentByUser[userId] ?? fallback ?? this.fallback
  }

  async setCurrentForUser(userId: string, path: string) {
    this.currentByUser[userId] = path
  }

  async save(name: string, path: string) {
    this.named[name] = path
  }

  async use(name: string) {
    return this.named[name]
  }

  async remove(name: string) {
    delete this.named[name]
  }

  async list() {
    return Object.entries(this.named).map(([name, path]) => ({ name, path }))
  }

  async bindGroup(chatId: string, name: string, path: string) {
    this.groups[chatId] = { name, path, createdAt: new Date().toISOString() }
  }
}

class FakeSessions {
  scopes: ThreadScope[] = []

  async list() {
    return this.scopes
  }
}

class FakeActiveRuns {
  private runs = new Map<string, any>()

  get(scopeId: string) {
    return this.runs.get(scopeId)
  }

  set(scopeId: string, run: any) {
    this.runs.set(scopeId, { run })
  }

  unregister(scopeId: string) {
    this.runs.delete(scopeId)
  }

  list() {
    return Array.from(this.runs.values())
  }
}

class FakeSingle {
  calls: Array<{ scope: ThreadScope; track: TrackState; agent: any; prompt: string; replyToMessageId: string }> = []

  async runTrack(input: { scope: ThreadScope; track: TrackState; agent: any; prompt: string; replyToMessageId: string }) {
    this.calls.push(input)
    return { ...input.track, lastRunId: `run-${this.calls.length}` }
  }
}
