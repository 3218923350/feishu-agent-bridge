import { appPath } from '../core/paths.js'
import { readVersionedJson, writeVersionedJson, type VersionedStore } from '../core/json-store.js'
import { JsonlStore } from './jsonl-store.js'
import type { ActivityRecord, ContextSummary, MemoryRecord, ObserverInboxRecord, RootTodo, TodoStatus, WorkOrder, WorkOrderStatus } from './types.js'

function nowIso(): string {
  return new Date().toISOString()
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export interface RootChatPolicy {
  chatId: string
  silentObserve?: boolean
  updatedAt: string
}

export class ObserverInboxStore extends JsonlStore<ObserverInboxRecord> {
  constructor(path = appPath('observer-inbox.jsonl')) {
    super(path)
  }
}

export class ActivityStore extends JsonlStore<ActivityRecord> {
  constructor(path = appPath('activity.jsonl')) {
    super(path)
  }
}

export class ContextSummaryStore extends JsonlStore<ContextSummary> {
  constructor(path = appPath('context-summaries.jsonl')) {
    super(path)
  }

  async relevant(scopeId: string, limit = 5): Promise<ContextSummary[]> {
    const all = await this.readAll()
    return all.filter((summary) => summary.scopeId === scopeId).slice(-limit)
  }
}

interface TodoState {
  todos: RootTodo[]
}

const TODO_STORE: VersionedStore<TodoState> = { schemaVersion: 1, data: { todos: [] } }

export class TodoStore {
  constructor(private readonly path = appPath('todos.json')) {}

  async add(input: { text: string; at: string; source?: RootTodo['source'] }): Promise<RootTodo> {
    const store = await this.load()
    const todo: RootTodo = {
      id: makeId('todo'),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'pending',
      text: input.text,
      at: input.at,
      source: input.source,
    }
    store.data.todos.push(todo)
    await writeVersionedJson(this.path, store)
    return todo
  }

  async list(status?: TodoStatus): Promise<RootTodo[]> {
    const todos = (await this.load()).data.todos
    return status ? todos.filter((todo) => todo.status === status) : todos
  }

  async due(at = new Date()): Promise<RootTodo[]> {
    return (await this.list('pending')).filter((todo) => {
      const ts = Date.parse(todo.at)
      return Number.isFinite(ts) && ts <= at.getTime()
    })
  }

  async update(id: string, patch: Partial<Pick<RootTodo, 'status' | 'text' | 'at'>>): Promise<RootTodo | undefined> {
    const store = await this.load()
    const todo = store.data.todos.find((item) => item.id === id)
    if (!todo) return undefined
    Object.assign(todo, patch, { updatedAt: nowIso() })
    await writeVersionedJson(this.path, store)
    return todo
  }

  private load(): Promise<VersionedStore<TodoState>> {
    return readVersionedJson(this.path, TODO_STORE)
  }
}

interface WorkOrderState {
  workOrders: WorkOrder[]
}

const WORK_ORDER_STORE: VersionedStore<WorkOrderState> = { schemaVersion: 1, data: { workOrders: [] } }

export class WorkOrderStore {
  constructor(private readonly path = appPath('work-orders.json')) {}

  async create(input: Omit<WorkOrder, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<WorkOrder> {
    const store = await this.load()
    const order: WorkOrder = {
      id: makeId('wo'),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'pending',
      ...input,
    }
    store.data.workOrders.push(order)
    await writeVersionedJson(this.path, store)
    return order
  }

  async list(status?: WorkOrderStatus): Promise<WorkOrder[]> {
    const orders = (await this.load()).data.workOrders
    return status ? orders.filter((order) => order.status === status) : orders
  }

  async update(id: string, patch: Partial<Pick<WorkOrder, 'status' | 'result' | 'error'>>): Promise<WorkOrder | undefined> {
    const store = await this.load()
    const order = store.data.workOrders.find((item) => item.id === id)
    if (!order) return undefined
    Object.assign(order, patch, { updatedAt: nowIso() })
    await writeVersionedJson(this.path, store)
    return order
  }

  private load(): Promise<VersionedStore<WorkOrderState>> {
    return readVersionedJson(this.path, WORK_ORDER_STORE)
  }
}

interface MemoryState {
  memories: MemoryRecord[]
}

const MEMORY_STORE: VersionedStore<MemoryState> = { schemaVersion: 1, data: { memories: [] } }

export class MemoryStore {
  constructor(private readonly path = appPath('memory-index.json')) {}

  async add(input: Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryRecord> {
    const store = await this.load()
    const existing = store.data.memories.find((memory) => memory.path === input.path && memory.abstract === input.abstract)
    if (existing) return existing
    const memory: MemoryRecord = {
      id: makeId('mem'),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...input,
    }
    store.data.memories.push(memory)
    await writeVersionedJson(this.path, store)
    return memory
  }

  async search(query: string, limit = 8): Promise<MemoryRecord[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return (await this.list()).slice(-limit)
    return (await this.list())
      .map((memory) => ({ memory, score: scoreMemory(memory, terms) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((row) => row.memory)
  }

  async list(): Promise<MemoryRecord[]> {
    return (await this.load()).data.memories
  }

  private load(): Promise<VersionedStore<MemoryState>> {
    return readVersionedJson(this.path, MEMORY_STORE)
  }
}

function scoreMemory(memory: MemoryRecord, terms: string[]): number {
  const haystack = [
    memory.path,
    memory.abstract,
    memory.overview ?? '',
    memory.content ?? '',
    memory.tags.join(' '),
  ].join('\n').toLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

interface RootPolicyState {
  chats: Record<string, RootChatPolicy>
}

const ROOT_POLICY_STORE: VersionedStore<RootPolicyState> = { schemaVersion: 1, data: { chats: {} } }

export class RootPolicyStore {
  constructor(private readonly path = appPath('root-policies.json')) {}

  async get(chatId: string): Promise<RootChatPolicy | undefined> {
    return (await this.load()).data.chats[chatId]
  }

  async setChatPolicy(chatId: string, patch: Omit<Partial<RootChatPolicy>, 'chatId' | 'updatedAt'>): Promise<RootChatPolicy> {
    const store = await this.load()
    const current = store.data.chats[chatId] ?? { chatId, updatedAt: nowIso() }
    const next = { ...current, ...patch, chatId, updatedAt: nowIso() }
    store.data.chats[chatId] = next
    await writeVersionedJson(this.path, store)
    return next
  }

  private load(): Promise<VersionedStore<RootPolicyState>> {
    return readVersionedJson(this.path, ROOT_POLICY_STORE)
  }
}
