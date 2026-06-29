import { appPath } from '../core/paths.js'
import { readVersionedJson, writeVersionedJson, type VersionedStore } from '../core/json-store.js'
import type { ThreadScope } from './thread-scope.js'

type ScopeMap = Record<string, ThreadScope>
const STORE_PATH = appPath('sessions.json')
const DEFAULT_STORE: VersionedStore<ScopeMap> = { schemaVersion: 1, data: {} }

export class SessionStore {
  async get(scopeId: string): Promise<ThreadScope | undefined> {
    return (await this.load()).data[scopeId]
  }

  async upsert(scope: ThreadScope): Promise<void> {
    const store = await this.load()
    store.data[scope.scopeId] = { ...scope, updatedAt: new Date().toISOString() }
    await writeVersionedJson(STORE_PATH, store)
  }

  async delete(scopeId: string): Promise<void> {
    const store = await this.load()
    delete store.data[scopeId]
    await writeVersionedJson(STORE_PATH, store)
  }

  async list(): Promise<ThreadScope[]> {
    return Object.values((await this.load()).data)
  }

  private load(): Promise<VersionedStore<ScopeMap>> {
    return readVersionedJson(STORE_PATH, DEFAULT_STORE)
  }
}

