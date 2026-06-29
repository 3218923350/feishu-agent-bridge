import type { CachedAttachment } from '../media/cache.js'

export type InboundChatType = 'p2p' | 'group'

export interface InboundMessage {
  chatId: string
  chatType: InboundChatType
  threadId?: string
  messageId: string
  text: string
  senderId: string
  mentionsBot: boolean
  mentions: Array<{ openId: string; name: string }>
  attachments: CachedAttachment[]
}

export interface CardAction {
  action: string
  value: Record<string, unknown>
  messageId?: string
  openId?: string
}

export function extractMessage(data: any, botOpenId?: string): InboundMessage | null {
  const msg = data?.message
  if (!msg?.chat_id || !msg?.message_id) return null
  const senderId = data?.sender?.sender_id?.open_id ?? ''
  const content = parseContent(msg.content)
  const text = extractText(msg.message_type, content)
  const mentions = Array.isArray(msg.mentions) ? msg.mentions : []
  const mentionsBot = msg.chat_type === 'p2p' || Boolean(botOpenId && mentions.some((m: any) => m.id?.open_id === botOpenId))
  const parsedMentions = mentions.map((mention: any) => ({
    openId: String(mention.id?.open_id ?? ''),
    name: String(mention.name ?? mention.id?.open_id ?? ''),
  })).filter((mention: { openId: string; name: string }) => mention.openId || mention.name)
  const rootId = msg.root_id ?? msg.thread_id ?? undefined
  const threadId = rootId && rootId !== msg.message_id ? rootId : undefined

  return {
    chatId: msg.chat_id,
    chatType: msg.chat_type === 'p2p' ? 'p2p' : 'group',
    threadId,
    messageId: msg.message_id,
    text,
    senderId,
    mentionsBot,
    mentions: parsedMentions,
    attachments: [],
  }
}

export function extractCardAction(data: any): CardAction | null {
  const action = data?.event?.action ?? data?.action
  const value = action?.value
  if (!value) return null
  return {
    action: String(value.cmd ?? value.action ?? ''),
    value,
    messageId: data?.context?.open_message_id ?? data?.open_message_id,
    openId: data?.operator?.open_id,
  }
}

function parseContent(raw: string | undefined): any {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function extractText(messageType: string, content: any): string {
  if (messageType === 'text') return String(content.text ?? '').replace(/@_user_\d+/g, '').trim()
  if (messageType === 'post') {
    const lines: string[] = content.title ? [content.title] : []
    for (const paragraph of content.content ?? []) {
      for (const node of paragraph ?? []) {
        if (node.tag === 'text') lines.push(node.text ?? '')
        if (node.tag === 'a') lines.push(node.text ?? node.href ?? '')
      }
    }
    return lines.join(' ').trim()
  }
  if (messageType === 'image') return '[image]'
  if (messageType === 'file') return '[file]'
  return `[${messageType}]`
}
