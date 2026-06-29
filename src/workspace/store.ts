import { appPath } from '../core/paths.js'
import { readVersionedJson, writeVersionedJson, type VersionedStore } from '../core/json-store.js'

export interface WorkspaceState {
  currentByUser: Record<string, string>
  named: Record<string, string>
  groups: Record<string, { path: string; name: string; createdAt: string }>
}

const STORE_PATH = appPath('workspaces.json')
const DEFAULT_STORE: VersionedStore<WorkspaceState> = {
  schemaVersion: 1,
  data: { currentByUser: {}, named: {}, groups: {} },
}

export class WorkspaceStore {
  async currentForUser(userId: string, fallback: string): Promise<string> {
    return (await this.load()).data.currentByUser[userId] ?? fallback
  }

  async setCurrentForUser(userId: string, path: string): Promise<void> {
    const store = await this.load()
    store.data.currentByUser[userId] = path
    await writeVersionedJson(STORE_PATH, store)
  }

  async save(name: string, path: string): Promise<void> {
    const store = await this.load()
    store.data.named[name] = path
    await writeVersionedJson(STORE_PATH, store)
  }

  async use(name: string): Promise<string | undefined> {
    return (await this.load()).data.named[name]
  }

  async remove(name: string): Promise<void> {
    const store = await this.load()
    delete store.data.named[name]
    await writeVersionedJson(STORE_PATH, store)
  }

  async list(): Promise<Array<{ name: string; path: string }>> {
    return Object.entries((await this.load()).data.named).map(([name, path]) => ({ name, path }))
  }

  async bindGroup(chatId: string, name: string, path: string): Promise<void> {
    const store = await this.load()
    store.data.groups[chatId] = { name, path, createdAt: new Date().toISOString() }
    await writeVersionedJson(STORE_PATH, store)
  }

  async groupPath(chatId: string): Promise<string | undefined> {
    return (await this.load()).data.groups[chatId]?.path
  }

  private load(): Promise<VersionedStore<WorkspaceState>> {
    return readVersionedJson(STORE_PATH, DEFAULT_STORE)
  }
}

