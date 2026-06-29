import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import TOML from '@iarna/toml'
import { appPath } from '../core/paths.js'
import { DEFAULT_CONFIG, type BridgeConfig } from './schema.js'

export const CONFIG_FILE = appPath('config.toml')

export function loadConfig(path = CONFIG_FILE): BridgeConfig {
  if (!existsSync(path)) return DEFAULT_CONFIG
  const parsed = TOML.parse(readFileSync(path, 'utf8')) as unknown as Partial<BridgeConfig>
  return deepMerge(DEFAULT_CONFIG, parsed) as BridgeConfig
}

export function writeInitialConfig(config: BridgeConfig, path = CONFIG_FILE): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, TOML.stringify(config as any))
}

function deepMerge(target: any, source: any): any {
  if (!source) return target
  const out = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(target?.[key] ?? {}, value)
    } else {
      out[key] = value
    }
  }
  return out
}

