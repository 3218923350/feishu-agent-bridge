import { describe, expect, it } from 'vitest'
import { extractMessage } from '../../src/connector/events.js'

describe('extractMessage', () => {
  it('requires a matching bot mention in group chats', () => {
    const data = baseEvent({
      chat_type: 'group',
      mentions: [{ id: { open_id: 'ou_bot' }, name: 'Bridge Bot' }],
    })

    expect(extractMessage(data, 'ou_bot')?.mentionsBot).toBe(true)
    expect(extractMessage(data, 'ou_bot')?.mentions).toEqual([{ openId: 'ou_bot', name: 'Bridge Bot' }])
    expect(extractMessage(data, 'ou_other')?.mentionsBot).toBe(false)
    expect(extractMessage(data)?.mentionsBot).toBe(false)
  })

  it('treats private chats as addressed to the bot', () => {
    const data = baseEvent({ chat_type: 'p2p' })

    expect(extractMessage(data)?.mentionsBot).toBe(true)
  })
})

function baseEvent(message: Record<string, unknown> = {}) {
  return {
    sender: { sender_id: { open_id: 'ou_sender' } },
    message: {
      chat_id: 'oc_test',
      chat_type: 'group',
      message_id: 'om_test',
      message_type: 'text',
      content: JSON.stringify({ text: 'hello' }),
      ...message,
    },
  }
}
