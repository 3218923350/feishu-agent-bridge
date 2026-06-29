import type { BridgeConfig } from '../config/schema.js'

export class FeishuApi {
  private token = ''
  private tokenExpiresAt = 0
  private readonly baseUrl: string

  constructor(private readonly config: BridgeConfig['feishu']) {
    this.baseUrl = config.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
  }

  async sendText(chatId: string, text: string): Promise<string> {
    return this.sendMessage(chatId, 'text', JSON.stringify({ text }))
  }

  async sendTextToOpenId(openId: string, text: string): Promise<string> {
    return this.sendMessageTo('open_id', openId, 'text', JSON.stringify({ text }))
  }

  async sendCard(chatId: string, card: object): Promise<string> {
    return this.sendMessage(chatId, 'interactive', JSON.stringify(card))
  }

  async replyText(messageId: string, text: string): Promise<string> {
    return this.replyMessage(messageId, 'text', JSON.stringify({ text }))
  }

  async replyCard(messageId: string, card: object): Promise<string> {
    return this.replyMessage(messageId, 'interactive', JSON.stringify(card))
  }

  async updateCard(messageId: string, card: object): Promise<void> {
    const token = await this.getToken()
    const result = await this.request(`/open-apis/im/v1/messages/${messageId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ msg_type: 'interactive', content: JSON.stringify(card) }),
    })
    if (result.code !== 0) console.error(`[feishu] update card failed: ${result.code} ${result.msg}`)
  }

  async reactToMessage(messageId: string, emojiType: string): Promise<void> {
    const token = await this.getToken()
    const result = await this.request(`/open-apis/im/v1/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ reaction_type: { emoji_type: emojiType } }),
    })
    if (result.code !== 0) console.error(`[feishu] react failed: ${result.code} ${result.msg}`)
  }

  async createGroup(name: string, userOpenIds: string[]): Promise<string> {
    const token = await this.getToken()
    const result = await this.request('/open-apis/im/v1/chats', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ name, user_id_list: userOpenIds }),
    })
    if (result.code !== 0) throw new Error(`create group failed: ${result.code} ${result.msg}`)
    return result.data?.chat_id ?? ''
  }

  async getBotOpenId(): Promise<string> {
    const token = await this.getToken()
    const result = await this.request('/open-apis/bot/v3/info', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (result.code !== 0) throw new Error(`bot info failed: ${result.code} ${result.msg}`)
    return result.bot?.open_id ?? result.data?.open_id ?? ''
  }

  private async sendMessage(chatId: string, msgType: string, content: string): Promise<string> {
    return this.sendMessageTo('chat_id', chatId, msgType, content)
  }

  private async sendMessageTo(receiveIdType: 'chat_id' | 'open_id', receiveId: string, msgType: string, content: string): Promise<string> {
    const token = await this.getToken()
    const result = await this.request(`/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ receive_id: receiveId, msg_type: msgType, content }),
    })
    if (result.code !== 0) console.error(`[feishu] send failed: ${result.code} ${result.msg}`)
    return result.data?.message_id ?? ''
  }

  private async replyMessage(messageId: string, msgType: string, content: string): Promise<string> {
    const token = await this.getToken()
    const result = await this.request(`/open-apis/im/v1/messages/${messageId}/reply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ msg_type: msgType, content, reply_in_thread: true }),
    })
    if (result.code !== 0) console.error(`[feishu] reply failed: ${result.code} ${result.msg}`)
    return result.data?.message_id ?? ''
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token
    const result = await this.request('/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.config.app_id, app_secret: this.config.app_secret }),
    })
    if (result.code !== 0) throw new Error(`tenant token failed: ${result.code} ${result.msg}`)
    this.token = result.tenant_access_token
    this.tokenExpiresAt = Date.now() + 25 * 60_000
    return this.token
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    const resp = await fetch(`${this.baseUrl}${path}`, init)
    return resp.json()
  }
}
