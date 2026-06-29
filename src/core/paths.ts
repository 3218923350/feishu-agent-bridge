import { homedir } from 'node:os'
import { join } from 'node:path'

export const APP_HOME_ENV = 'FEISHU_AGENT_BRIDGE_HOME'

export function appHome(): string {
  return process.env[APP_HOME_ENV] || join(homedir(), '.feishu-agent-bridge')
}

export function appPath(...parts: string[]): string {
  return join(appHome(), ...parts)
}

