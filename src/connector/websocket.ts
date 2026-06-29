import * as Lark from '@larksuiteoapi/node-sdk'
import type { BridgeConfig } from '../config/schema.js'

export function createWsClient(config: BridgeConfig): Lark.WSClient {
  return new Lark.WSClient({
    appId: config.feishu.app_id,
    appSecret: config.feishu.app_secret,
    domain: config.feishu.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.info,
  })
}

