import { describe, expect, it } from 'vitest'
import { canUseBridge } from '../../src/policy/access.js'
import type { AccessState } from '../../src/policy/access-store.js'

const state: AccessState = {
  owner_open_id: 'ou_owner',
  allowed_users: ['ou_user'],
  allowed_chats: ['oc_group'],
  admins: ['ou_admin'],
  require_mention_in_group: true,
}

describe('access policy', () => {
  it('allows owner everywhere', () => {
    expect(canUseBridge(state, { senderId: 'ou_owner', chatType: 'group', chatId: 'oc_any' }).ok).toBe(true)
  })

  it('defaults to deny unknown dm users', () => {
    expect(canUseBridge(state, { senderId: 'ou_unknown', chatType: 'p2p' })).toEqual({
      ok: false,
      reason: 'denied-user',
    })
  })

  it('allows invited groups', () => {
    expect(canUseBridge(state, { senderId: 'ou_someone', chatType: 'group', chatId: 'oc_group' }).ok).toBe(true)
  })
})

