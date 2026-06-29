# feishu-agent-bridge

一个把飞书/Lark 机器人消息桥接到本地 Claude Code 和 Codex 的 TypeScript 项目。

## 能做什么

- 通过飞书/Lark 官方长连接 SDK 接收机器人消息事件。
- 在飞书里用交互卡片展示本地 agent 的运行状态和输出。
- 普通消息默认交给 Claude Code 处理，作为主会话轨道 `mainTrack`。
- `/review` 会交给 Codex 处理，作为审查轨道 `reviewTrack`。
- `/debate` 会让 Claude Code 和 Codex 轮流讨论同一个问题。
- 按飞书话题/thread 维持独立 session，同一个话题里的追问会继续复用上下文。
- 本地保存配置、权限、工作区和 session 元数据。
- 默认按 owner/admin/user/group 做访问控制。

## 环境要求

- Node.js `>=20.12.0`
- 一个飞书/Lark 自建应用，并开启「使用长连接接收事件/回调」
- 本机 `PATH` 里能找到 `claude` CLI
- 本机 `PATH` 里能找到 `codex` CLI

## 安装和检查

```bash
npm install
npm run build
npm run lint
npm test
```

## 初始化配置

第一次使用前需要执行：

```bash
npm run build
node dist/cli.js init
```

如果已经全局安装或 `npm link` 过，也可以执行：

```bash
feishu-agent-bridge init
```

这个 `init` 命令会交互式询问：

- 飞书/Lark App ID
- 飞书/Lark App Secret
- 域名类型：`feishu` 或 `lark`
- owner 的 `open_id`，推荐填写，但也可以先留空

执行完成后，会自动生成配置文件：

```text
~/.feishu-agent-bridge/config.toml
```

也就是说，`config.toml` 是 `init` 命令生成的，不需要手动提前创建。如果没有执行过 `init`，直接启动时会因为缺少 `app_id`/`app_secret` 报错。

如果 `owner_open_id` 留空，机器人收到第一条私聊消息时，会把这个私聊发送者自动设为 owner。这个 owner 状态会写入：

```text
~/.feishu-agent-bridge/access.json
```

## 启动

开发模式：

```bash
npm run dev -- --cwd /path/to/project
```

构建后启动：

```bash
npm run build
node dist/cli.js start --cwd /path/to/project
```

启动成功后会看到类似日志：

```text
event-dispatch is ready
feishu-agent-bridge started
cwd: /path/to/project
domain: feishu
ws client ready
```

这个项目不是 HTTP 服务，所以不会有 localhost 地址。它会保持飞书/Lark 长连接，收到机器人消息后再回复。

## 飞书里可以用的命令

| 命令 | 使用位置 | 效果 |
| --- | --- | --- |
| `/help` | 私聊或已授权群 | 显示命令帮助卡片。 |
| `/new` | 当前话题/thread | 停止当前话题里的运行任务，并重置当前话题 session。下一条消息会重新开始。 |
| `/new chat [名称]` | 仅私聊 | 创建一个项目群，把当前用户加入群，并把这个群绑定到当前工作目录。 |
| `/stop` | 当前话题/thread | 停止当前话题里正在运行的本地 agent 进程。 |
| `/status` | 私聊或已授权群 | 显示活跃任务数、工作区数量、session 数量和最近 session 信息。 |
| `/cd <路径>` | 仅私聊 | 设置当前用户的工作目录。路径必须在本机存在。 |
| `/ls` | 私聊 | 查看当前用户的工作目录。 |
| `/ws list` | 私聊或已授权群 | 查看保存过的工作区。 |
| `/ws save <名称>` | 私聊 | 把当前目录保存成一个命名工作区。 |
| `/ws use <名称>` | 仅私聊 | 切换到某个已保存工作区。 |
| `/ws remove <名称>` | 私聊或已授权群 | 删除一个已保存工作区。 |
| `/invite user <open_id>` | owner/admin | 允许某个用户在私聊里使用机器人。 |
| `/invite admin <open_id>` | owner/admin | 授予某个用户 admin 权限。 |
| `/invite group` | owner/admin，在群里执行 | 允许当前群使用机器人。 |
| `/remove user <open_id>` | owner/admin | 移除某个用户的私聊使用权限。 |
| `/remove admin <open_id>` | owner/admin | 移除某个用户的 admin 权限。 |
| `/remove group` | owner/admin，在群里执行 | 移除当前群的使用权限。 |

没有被命令路由识别的斜杠消息，会继续作为普通 prompt 交给 agent。

## 普通消息怎么处理

授权用户发送的普通消息会进入 Claude Code 的 `mainTrack`。

运行逻辑：

- 私聊使用当前用户的工作目录；如果没设置过，就使用启动命令里的 `--cwd`。
- 群聊使用群绑定的项目目录；如果没有绑定，就使用启动命令里的 `--cwd`。
- 同一个飞书话题/thread 会复用保存过的 Claude session。
- 同一个话题里如果已有任务在跑，后续消息会排队等待。

Claude Code 当前启动参数是：

```text
claude --print --output-format stream-json --verbose --dangerously-skip-permissions
```

`config.toml` 里的 model、session resume id、extra args 会继续追加进去。

## Review 模式

使用：

```text
/review <问题>
```

效果：

- 使用 Codex 的 `reviewTrack`。
- 如果当前话题之前已经有 Codex thread，会尽量复用。
- 会要求 Codex 自己检查仓库和当前任务上下文，而不是只看桥接层转述。
- 输出同样会以飞书交互卡片流式更新。

示例：

```text
/review 看一下当前改动有没有明显 bug，尤其关注权限和会话状态
```

Codex 当前启动参数是：

```text
codex exec --json -s danger-full-access --dangerously-bypass-approvals-and-sandbox
```

`config.toml` 里的 model、thread id、extra args 会继续追加进去。

## Debate 模式

使用：

```text
/debate <问题>
```

效果：

- 在当前话题里启动双 agent 讨论。
- 奇数轮使用 Claude Code 的 `mainTrack`。
- 偶数轮使用 Codex 的 `reviewTrack`。
- 当前实现最多允许 30 轮交替。
- 每一轮都会更新对应 track 的 session 状态。

示例：

```text
/debate 这个桥接进程应该怎么做常驻和故障恢复，给我一个工程上靠谱的方案
```

运行中可以用 `/stop` 或卡片上的停止按钮中断。

## 权限模型

权限是 owner-first：

- owner 可以使用机器人，也可以管理权限。
- admin 可以管理权限。
- 被邀请的 user 可以私聊使用机器人。
- 被邀请的 group 可以在群里使用机器人。
- 如果配置里没有 owner，第一位私聊用户会自动成为 owner。

运行时权限状态保存在：

```text
~/.feishu-agent-bridge/access.json
```

## 本地数据文件

桥接进程的本地状态默认保存在：

```text
~/.feishu-agent-bridge/
```

常见文件：

| 文件 | 用途 |
| --- | --- |
| `config.toml` | 飞书/Lark app 配置、默认 agent 配置、展示配置、安全配置。 |
| `access.json` | 运行时更新的 owner/admin/user/group 权限。 |
| `workspaces.json` | 用户当前目录、命名工作区、群和项目路径绑定。 |
| `sessions.json` | 飞书话题和 Claude/Codex session 的绑定关系。 |

## macOS 常驻运行

本机使用时，可以用 LaunchAgent 做常驻：

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.feishu-agent-bridge.plist
launchctl kickstart -k gui/$(id -u)/com.feishu-agent-bridge
launchctl print gui/$(id -u)/com.feishu-agent-bridge
```

查看日志：

```bash
tail -f ~/.feishu-agent-bridge/logs/launchd.err.log
tail -f ~/.feishu-agent-bridge/logs/launchd.out.log
```

## 依赖和开源前注意事项

主要运行时依赖：

- `@larksuiteoapi/node-sdk`：飞书/Lark 长连接和事件分发。
- `@iarna/toml`：读取和写入 `config.toml`。
- `commander`：CLI 命令解析。

开发依赖：

- `tsx`：本地开发运行 TypeScript。
- `tsup`：构建 `dist`。
- `typescript`：类型检查。
- `vitest`：单元测试。

开源前不要提交本机运行数据和密钥。当前 `.gitignore` 已排除 `node_modules`、`dist`、`coverage`、`.env` 和 `*.log`；飞书应用密钥默认写在用户主目录下的 `~/.feishu-agent-bridge/config.toml`，不会落在仓库目录里。
