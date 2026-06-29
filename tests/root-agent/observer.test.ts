import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type BridgeConfig } from '../../src/config/schema.js'
import type { InboundMessage } from '../../src/connector/events.js'
import { RootAgentObserver } from '../../src/root-agent/observer.js'

describe('RootAgentObserver', () => {
  it('stores silent group messages and DMs owner when attention crosses threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fab-root-agent-'))
    const api = new FakeApi()
    const observer = new RootAgentObserver(config(), api as any, {
      inboxPath: join(dir, 'observer-inbox.jsonl'),
      activityPath: join(dir, 'activity.jsonl'),
      now: () => new Date('2026-06-29T12:00:00.000Z'),
    })

    const decision = await observer.observe(message({
      text: '这个事情需要王毅关注一下，和主动员工 Agent 有关',
    }), security())

    expect(decision).toMatchObject({ action: 'dm_owner', score: 0.85 })
    expect(api.sent).toHaveLength(1)
    expect(api.sent[0]).toMatchObject({ openId: 'ou_owner' })
    expect(api.sent[0].text).toContain('主动员工 Agent')

    const inbox = await readFile(join(dir, 'observer-inbox.jsonl'), 'utf8')
    expect(JSON.parse(inbox.trim())).toMatchObject({
      chatId: 'oc_group',
      messageId: 'om_msg',
      text: '这个事情需要王毅关注一下，和主动员工 Agent 有关',
    })

    const activity = await readFile(join(dir, 'activity.jsonl'), 'utf8')
    expect(JSON.parse(activity.trim())).toMatchObject({
      kind: 'dm-owner',
      messageId: 'om_msg',
    })
  })

  it('does not handle mentioned messages because the normal reply flow owns them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fab-root-agent-'))
    const api = new FakeApi()
    const observer = new RootAgentObserver(config(), api as any, {
      inboxPath: join(dir, 'observer-inbox.jsonl'),
      activityPath: join(dir, 'activity.jsonl'),
    })

    const decision = await observer.observe(message({ mentionsBot: true }), security())

    expect(decision).toBeUndefined()
    expect(api.sent).toEqual([])
  })
})

function config(): BridgeConfig {
  return {
    ...DEFAULT_CONFIG,
    root_agent: {
      ...DEFAULT_CONFIG.root_agent,
      enabled: true,
      owner_open_id: 'ou_owner',
      owner_aliases: ['王毅'],
    },
    observe: {
      ...DEFAULT_CONFIG.observe,
      enabled: true,
      dm_owner_when_attention_score_above: 0.75,
      attention_keywords: ['主动员工 Agent'],
    },
  }
}

function security() {
  return {
    owner_open_id: 'ou_owner',
    allowed_users: [],
    allowed_chats: ['oc_group'],
    admins: [],
    require_mention_in_group: true,
  }
}

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    chatId: 'oc_group',
    chatType: 'group',
    messageId: 'om_msg',
    text: 'hello',
    senderId: 'ou_sender',
    mentionsBot: false,
    mentions: [],
    attachments: [],
    ...overrides,
  }
}

class FakeApi {
  sent: Array<{ openId: string; text: string }> = []

  async sendTextToOpenId(openId: string, text: string) {
    this.sent.push({ openId, text })
    return `dm-${this.sent.length}`
  }
}
