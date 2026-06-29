import type { AccessState } from './access-store.js'

export type ChatType = 'p2p' | 'group' | 'comment'

export interface AccessInput {
  senderId: string
  chatId?: string
  chatType: ChatType
}

export interface AccessDecision {
  ok: boolean
  reason: 'owner' | 'admin' | 'allowed-user' | 'allowed-chat' | 'comment' | 'denied-user' | 'denied-chat'
}

export function canUseBridge(security: AccessState, input: AccessInput): AccessDecision {
  if (security.owner_open_id && input.senderId === security.owner_open_id) return allow('owner')
  if (security.admins.includes(input.senderId)) return allow('admin')
  if (input.chatType === 'comment') return allow('comment')
  if (input.chatType === 'p2p') {
    return security.allowed_users.includes(input.senderId) ? allow('allowed-user') : deny('denied-user')
  }
  if (input.chatId && security.allowed_chats.includes(input.chatId)) return allow('allowed-chat')
  return deny('denied-chat')
}

export function canAdmin(security: AccessState, senderId: string): boolean {
  return Boolean(security.owner_open_id && senderId === security.owner_open_id) ||
    security.admins.includes(senderId)
}

function allow(reason: AccessDecision['reason']): AccessDecision {
  return { ok: true, reason }
}

function deny(reason: AccessDecision['reason']): AccessDecision {
  return { ok: false, reason }
}
