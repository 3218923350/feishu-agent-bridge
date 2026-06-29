import type { FeishuApi } from '../connector/api.js'
import type { InboundMessage } from '../connector/events.js'
import type { AccessStore } from '../policy/access-store.js'
import { canAdmin } from '../policy/access.js'
import { helpCard, textCard } from '../card/templates.js'
import { resolveExistingDirectory } from '../workspace/navigator.js'
import type { WorkspaceStore } from '../workspace/store.js'
import type { RunExecutor } from '../runtime/run-executor.js'
import type { SessionStore } from '../session/store.js'

export interface CommandContext {
  api: FeishuApi
  access: AccessStore
  workspaces: WorkspaceStore
  sessions: SessionStore
  executor: RunExecutor
  defaultCwd: string
}

export interface CommandResult {
  handled: boolean
}

export async function handleCommand(message: InboundMessage, ctx: CommandContext): Promise<CommandResult> {
  const text = message.text.trim()
  if (!text.startsWith('/')) return { handled: false }
  const [cmd, ...args] = text.slice(1).split(/\s+/)
  const arg = args.join(' ')
  const replyTo = async (content: string) => ctx.api.replyText(message.threadId ?? message.messageId, content)
  const replyCard = async (card: object) => ctx.api.replyCard(message.threadId ?? message.messageId, card)

  switch (cmd) {
    case 'help':
      await replyCard(helpCard())
      return { handled: true }

    case 'stop': {
      const scopeId = message.threadId ? `${message.chatId}:${message.threadId}` : `${message.chatId}:${message.messageId}`
      const active = ctx.executor.activeRuns.get(scopeId)
      if (active) {
        active.interrupted = true
        await active.run.stop()
        ctx.executor.activeRuns.unregister(scopeId, active.run)
        await replyTo('已停止当前任务')
      } else {
        await replyTo('当前没有运行中的任务')
      }
      return { handled: true }
    }

    case 'new': {
      if (args[0] === 'chat') {
        if (message.chatType !== 'p2p') {
          await replyTo('请在 bot 私聊里执行 /new chat')
          return { handled: true }
        }
        const cwd = await ctx.workspaces.currentForUser(message.senderId, ctx.defaultCwd)
        const name = args.slice(1).join(' ') || cwd.split('/').filter(Boolean).at(-1) || 'agent-project'
        const chatId = await ctx.api.createGroup(name, [message.senderId])
        await ctx.workspaces.bindGroup(chatId, name, cwd)
        await replyTo(`已创建项目群 ${name}\n路径: ${cwd}`)
        return { handled: true }
      }
      const scopeId = message.threadId ? `${message.chatId}:${message.threadId}` : `${message.chatId}:${message.messageId}`
      const active = ctx.executor.activeRuns.get(scopeId)
      if (active) await active.run.stop().catch(() => {})
      ctx.executor.activeRuns.unregister(scopeId)
      await replyTo('已重置当前话题 session')
      return { handled: true }
    }

    case 'cd': {
      if (message.chatType !== 'p2p') {
        await stopGroupRun(message, ctx)
        await replyTo('群路径不可修改，请回 bot 私聊执行 /cd')
        return { handled: true }
      }
      if (!arg) {
        await replyTo('用法: /cd <path>')
        return { handled: true }
      }
      const cwd = await resolveExistingDirectory(arg)
      await ctx.workspaces.setCurrentForUser(message.senderId, cwd)
      await replyTo(`当前导航目录: ${cwd}`)
      return { handled: true }
    }

    case 'ls': {
      const cwd = await ctx.workspaces.currentForUser(message.senderId, ctx.defaultCwd)
      await replyTo(`当前目录: ${cwd}`)
      return { handled: true }
    }

    case 'ws':
      return handleWorkspaceCommand(message, args, ctx)

    case 'invite':
    case 'remove':
      return handleAccessCommand(message, cmd, args, ctx)

    case 'status': {
      const workspaces = await ctx.workspaces.list()
      const runs = ctx.executor.activeRuns.list()
      const scopes = await ctx.sessions.list()
      const lines = [
        `active runs: ${runs.length}`,
        `workspaces: ${workspaces.length}`,
        `sessions: ${scopes.length}`,
        '',
        ...scopes.slice(0, 10).map((scope) => [
          `scope: ${scope.scopeId}`,
          `path: ${scope.projectPath}`,
          `main: ${scope.mainTrack.agentId}${scope.mainTrack.sessionId ? ` session=${scope.mainTrack.sessionId}` : ''}${scope.mainTrack.threadId ? ` thread=${scope.mainTrack.threadId}` : ''}`,
          `review: ${scope.reviewTrack.agentId}${scope.reviewTrack.sessionId ? ` session=${scope.reviewTrack.sessionId}` : ''}${scope.reviewTrack.threadId ? ` thread=${scope.reviewTrack.threadId}` : ''}`,
        ].join('\n')),
      ]
      await replyCard(textCard('Status', [
        ...lines,
      ].join('\n\n')))
      return { handled: true }
    }

    default:
      return { handled: false }
  }
}

async function handleWorkspaceCommand(message: InboundMessage, args: string[], ctx: CommandContext): Promise<CommandResult> {
  const [sub, name] = args
  const replyTo = async (content: string) => ctx.api.replyText(message.threadId ?? message.messageId, content)
  if (message.chatType !== 'p2p' && sub === 'use') {
    await stopGroupRun(message, ctx)
    await replyTo('群路径不可修改，请回 bot 私聊执行 /ws use')
    return { handled: true }
  }
  if (sub === 'list') {
    const rows = await ctx.workspaces.list()
    await replyTo(rows.length ? rows.map((row) => `${row.name}: ${row.path}`).join('\n') : '无保存工作区')
    return { handled: true }
  }
  if (sub === 'save' && name) {
    const cwd = await ctx.workspaces.currentForUser(message.senderId, ctx.defaultCwd)
    await ctx.workspaces.save(name, cwd)
    await replyTo(`已保存工作区 ${name}: ${cwd}`)
    return { handled: true }
  }
  if (sub === 'use' && name) {
    const cwd = await ctx.workspaces.use(name)
    if (!cwd) await replyTo(`未找到工作区: ${name}`)
    else {
      await ctx.workspaces.setCurrentForUser(message.senderId, cwd)
      await replyTo(`已切换工作区 ${name}: ${cwd}`)
    }
    return { handled: true }
  }
  if (sub === 'remove' && name) {
    await ctx.workspaces.remove(name)
    await replyTo(`已删除工作区: ${name}`)
    return { handled: true }
  }
  await replyTo('用法: /ws list|save|use|remove <name>')
  return { handled: true }
}

async function handleAccessCommand(message: InboundMessage, cmd: string, args: string[], ctx: CommandContext): Promise<CommandResult> {
  const security = await ctx.access.snapshot()
  if (!canAdmin(security, message.senderId)) {
    await ctx.api.replyText(message.threadId ?? message.messageId, '只有 owner/admin 可以修改访问控制')
    return { handled: true }
  }

  const [target, id] = args
  if (target === 'group') {
    if (cmd === 'invite') await ctx.access.addChat(message.chatId)
    else await ctx.access.removeChat(message.chatId)
    await ctx.api.replyText(message.threadId ?? message.messageId, cmd === 'invite' ? '已开放当前群' : '已移除当前群授权')
    return { handled: true }
  }
  if (!id) {
    await ctx.api.replyText(message.threadId ?? message.messageId, `用法: /${cmd} user|admin <open_id> 或 /${cmd} group`)
    return { handled: true }
  }
  if (target === 'user') {
    if (cmd === 'invite') await ctx.access.addUser(id)
    else await ctx.access.removeUser(id)
  } else if (target === 'admin') {
    if (cmd === 'invite') await ctx.access.addAdmin(id)
    else await ctx.access.removeAdmin(id)
  }
  await ctx.api.replyText(message.threadId ?? message.messageId, '访问控制已更新')
  return { handled: true }
}

async function stopGroupRun(message: InboundMessage, ctx: CommandContext): Promise<void> {
  const scopeId = message.threadId ? `${message.chatId}:${message.threadId}` : `${message.chatId}:${message.messageId}`
  const active = ctx.executor.activeRuns.get(scopeId)
  if (active) await active.run.stop().catch(() => {})
}
