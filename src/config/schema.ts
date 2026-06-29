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
  root_agent: {
    enabled: boolean
    name: string
    owner_open_id: string
    owner_aliases: string[]
    main_session_id: string
    model: {
      provider: 'bedrock' | 'none'
      model: string
      region: string
      max_tokens: number
      env?: Record<string, string>
    }
  }
  defaults: {
    agent: 'claude' | 'codex'
    max_concurrent_sessions: number
    max_debate_rounds: number
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
  observe: {
    enabled: boolean
    silent_group_observe: boolean
    dm_owner_when_attention_score_above: number
    max_owner_dm_per_day: number
    attention_keywords: string[]
  }
}

export const DEFAULT_CONFIG: BridgeConfig = {
  feishu: { app_id: '', app_secret: '', domain: 'feishu' },
  root_agent: {
    enabled: false,
    name: 'Root Agent',
    owner_open_id: '',
    owner_aliases: [],
    main_session_id: 'main',
    model: {
      provider: 'none',
      model: '',
      region: 'us-east-1',
      max_tokens: 16384,
    },
  },
  defaults: {
    agent: 'claude',
    max_concurrent_sessions: 10,
    max_debate_rounds: 4,
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
  observe: {
    enabled: false,
    silent_group_observe: true,
    dm_owner_when_attention_score_above: 0.75,
    max_owner_dm_per_day: 8,
    attention_keywords: [],
  },
}
