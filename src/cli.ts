#!/usr/bin/env node
import { Command } from 'commander'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { DEFAULT_CONFIG } from './config/schema.js'
import { CONFIG_FILE, writeInitialConfig } from './config/store.js'

const program = new Command()
  .name('feishu-agent-bridge')
  .description('Bridge Feishu/Lark to Claude Code and Codex')
  .version('0.1.0')

program
  .command('init')
  .description('Create config.toml')
  .action(async () => {
    const rl = createInterface({ input, output })
    const appId = await rl.question('Feishu App ID: ')
    const appSecret = await rl.question('Feishu App Secret: ')
    const domain = (await rl.question('Domain (feishu/lark) [feishu]: ')) || 'feishu'
    const ownerOpenId = await rl.question('Owner open_id (recommended): ')
    rl.close()

    writeInitialConfig({
      ...DEFAULT_CONFIG,
      feishu: { app_id: appId, app_secret: appSecret, domain: domain === 'lark' ? 'lark' : 'feishu' },
      security: { ...DEFAULT_CONFIG.security, owner_open_id: ownerOpenId.trim() },
    })

    console.log(`Config written to ${CONFIG_FILE}`)
  })

program
  .command('start')
  .description('Start bridge foreground process')
  .option('--cwd <path>', 'Default working directory')
  .action(async (opts: { cwd?: string }) => {
    const { startBridge } = await import('./index.js')
    await startBridge({ cwd: opts.cwd })
  })

program.parse()

