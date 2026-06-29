export type RootAction = 'ignore' | 'remember_only' | 'dm_owner' | 'reply' | 'delegate'
export type WorkerKind = 'claude' | 'codex'
export type WorkOrderStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TodoStatus = 'pending' | 'claimed' | 'done' | 'cancelled'

export interface ObserverInboxRecord {
  id: string
  receivedAt: string
  chatId: string
  messageId: string
  threadId?: string
  senderId: string
  text: string
  mentions: Array<{ openId: string; name: string }>
  addressed: boolean
}

export interface ActivityRecord {
  id: string
  time: string
  kind: 'observe' | 'dm-owner' | 'remember-only' | 'ignore' | 'reply' | 'delegate' | 'todo' | 'memory' | 'context'
  messageId?: string
  chatId?: string
  summary: string
}

export interface RootDecision {
  action: RootAction
  score: number
  reason: string
  reply?: string
  delegate?: {
    worker: WorkerKind
    task: string
    expectedOutput?: string
  }
  memoryCandidates: string[]
  todo?: {
    text: string
    at: string
  }
}

export interface WorkOrder {
  id: string
  createdAt: string
  updatedAt: string
  status: WorkOrderStatus
  source: {
    chatId: string
    messageId: string
    threadId?: string
  }
  ownerOpenId: string
  worker: WorkerKind
  workspace: string
  task: string
  expectedOutput: string
  result?: string
  error?: string
}

export interface RootTodo {
  id: string
  createdAt: string
  updatedAt: string
  status: TodoStatus
  text: string
  at: string
  source?: {
    chatId?: string
    messageId?: string
    workOrderId?: string
  }
}

export interface MemoryRecord {
  id: string
  createdAt: string
  updatedAt: string
  path: string
  abstract: string
  overview?: string
  content?: string
  tags: string[]
  sourceIds: string[]
  confidence: 'confirmed' | 'hypothesis'
}

export interface ContextSummary {
  id: string
  createdAt: string
  kind: 'thread_summary' | 'work_order_summary' | 'event_summary'
  scopeId: string
  sourceIds: string[]
  summary: string
  facts: string[]
  openLoops: string[]
  memoryRefs: string[]
}
