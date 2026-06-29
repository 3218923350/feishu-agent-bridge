export type TenantDomain = 'feishu' | 'lark'

export interface FeishuConfig {
  app_id: string
  app_secret: string
  domain: TenantDomain
}

export interface AgentDefaults {
  model?: string
  extra_args: string[]
  env?: Record<string, string>
}

export interface BridgeConfig {
  feishu: FeishuConfig
  defaults: {
    agent: 'claude' | 'codex'
    max_concurrent_sessions: number
    idle_timeout_minutes: number
    default_permission: 'full'
    claude: AgentDefaults
    codex: AgentDefaults
  }
  display: {
    update_interval_ms: number
    show_thinking: boolean
    show_token_usage: boolean
    ack_reaction_emoji: string
  }
  security: {
    owner_open_id: string
    allowed_users: string[]
    allowed_chats: string[]
    admins: string[]
    require_mention_in_group: boolean
  }
}

export const DEFAULT_CONFIG: BridgeConfig = {
  feishu: { app_id: '', app_secret: '', domain: 'feishu' },
  defaults: {
    agent: 'claude',
    max_concurrent_sessions: 10,
    idle_timeout_minutes: 0,
    default_permission: 'full',
    claude: { model: 'opus', extra_args: [] },
    codex: { extra_args: [] },
  },
  display: { update_interval_ms: 1500, show_thinking: true, show_token_usage: true, ack_reaction_emoji: 'OK' },
  security: {
    owner_open_id: '',
    allowed_users: [],
    allowed_chats: [],
    admins: [],
    require_mention_in_group: true,
  },
}
