import { appPath } from '../core/paths.js'
import { readVersionedJson, writeVersionedJson, type VersionedStore } from '../core/json-store.js'
import type { BridgeConfig } from '../config/schema.js'

export interface AccessState {
  owner_open_id: string
  allowed_users: string[]
  allowed_chats: string[]
  admins: string[]
  require_mention_in_group: boolean
}

const STORE_PATH = appPath('access.json')

export class AccessStore {
  constructor(private readonly config: BridgeConfig) {}

  async snapshot(): Promise<AccessState> {
    const saved = await this.load()
    return {
      owner_open_id: saved.data.owner_open_id || this.config.security.owner_open_id,
      allowed_users: unique([...this.config.security.allowed_users, ...saved.data.allowed_users]),
      allowed_chats: unique([...this.config.security.allowed_chats, ...saved.data.allowed_chats]),
      admins: unique([...this.config.security.admins, ...saved.data.admins]),
      require_mention_in_group: saved.data.require_mention_in_group ?? this.config.security.require_mention_in_group,
    }
  }

  async addUser(openId: string): Promise<void> {
    await this.update((state) => state.allowed_users.push(openId))
  }

  async claimOwnerIfMissing(openId: string): Promise<boolean> {
    const store = await this.load()
    if (store.data.owner_open_id || this.config.security.owner_open_id) return false
    store.data.owner_open_id = openId
    await writeVersionedJson(STORE_PATH, store)
    return true
  }

  async addChat(chatId: string): Promise<void> {
    await this.update((state) => state.allowed_chats.push(chatId))
  }

  async addAdmin(openId: string): Promise<void> {
    await this.update((state) => state.admins.push(openId))
  }

  async removeUser(openId: string): Promise<void> {
    await this.update((state) => { state.allowed_users = state.allowed_users.filter((id) => id !== openId) })
  }

  async removeChat(chatId: string): Promise<void> {
    await this.update((state) => { state.allowed_chats = state.allowed_chats.filter((id) => id !== chatId) })
  }

  async removeAdmin(openId: string): Promise<void> {
    await this.update((state) => { state.admins = state.admins.filter((id) => id !== openId) })
  }

  private async update(fn: (state: AccessState) => void): Promise<void> {
    const store = await this.load()
    fn(store.data)
    store.data.allowed_users = unique(store.data.allowed_users)
    store.data.allowed_chats = unique(store.data.allowed_chats)
    store.data.admins = unique(store.data.admins)
    await writeVersionedJson(STORE_PATH, store)
  }

  private async load(): Promise<VersionedStore<AccessState>> {
    return readVersionedJson(STORE_PATH, {
      schemaVersion: 1,
      data: {
        owner_open_id: '',
        allowed_users: [],
        allowed_chats: [],
        admins: [],
        require_mention_in_group: this.config.security.require_mention_in_group,
      },
    })
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}
