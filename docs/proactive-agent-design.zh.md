# 主动员工 Agent 重新设计

这份文档重新定义 `feishu-agent-bridge` 的下一阶段：它不是一个“飞书消息转发到 Claude/Codex 的 bridge”，而是一个以 Root Agent 为核心的个人分身系统。

Root Agent 常驻、有记忆、会观察飞书群消息、会判断哪些事情值得提醒本人；真正需要干活时，它可以把任务委派给 Codex、Claude Code 或其他专用 Agent。Codex/Claude Code 不再是平级聊天对象，而是 Root Agent 可以自然语言调用的执行工具。

## 一句话目标

做一个“王毅的主动员工 Agent”：它在群里被 @ 这个 bot 时公开回答；没有被 @ 时不打扰群聊，但会持续观察所在群的消息，把需要王毅关注、决策或介入的事情私聊提醒给王毅，并能把任务拆给 Codex/Claude Code 去执行、复盘、沉淀记忆。

## 设计参考

### Cryochamber 给我们的关键启发

`GiggleLiu/cryochamber` 的核心不是“定时运行 Agent”，而是一个完整的后台生命周期：

- `messages/inbox/` 是外部事件进入 Agent 的统一入口。
- daemon watch inbox 和配置目录，文件变化可以立即触发一次 Agent session。
- TODO 是下一次主动触发的来源；原项目会用 `hibernate` 强制 Agent 声明下一步。
- 每次 session 都遵循 `orient -> work -> record -> confirm next step -> exit/idle` 的纪律。
- Agent 需要显式 `receive` 读取 inbox，`send` 和人沟通，`dialog` 看历史，`todo add/done/remove` 管理未来工作。
- 崩溃后 daemon 会记录 previous session crashed，并把 claimed TODO 以指数退避方式重新排期。
- agent 子进程可以是 Claude、Codex、OpenCode 或任意自定义命令，daemon 只管生命周期。

对本项目来说，Root Agent 部署在个人本机，不需要真的进入休眠模式；更合适的改造是吸收 cryochamber 的 inbox、TODO、record、crash recovery 和生命周期约束，但把 `hibernate` 改成 **always-on idle loop**：进程一直在，空闲时只监听事件和定时器，不启动重型模型调用。

这说明我们应该把当前 bridge 的内存队列升级为持久化 inbox/outbox/TODO，而不是只把飞书消息直接扔给 Claude/Codex。

### Shrimp 给我们的关键启发

`~/work/dp/agents/shrimp` 里有几块很值得借鉴：

- **ContextManager**：不是简单截断历史，而是把最近上下文保留为 L1，较早 turn 做结构化压缩，必要时进一步摘要。
- **context_summaries**：把跨 turn 的摘要持久化，不让每次都从完整历史重建。
- **tool result descriptor**：工具结果可以降级为描述符和摘要，必要时再按 id 拉回完整内容。
- **workflow snapshot cache**：压缩后的上下文快照可缓存，避免 replay 或多 step 过程中重复构造。
- **memoryService**：工作流结束后异步抽取记忆，不阻塞用户回复。
- **Memory API**：记忆有路径、目录树、语义搜索、关键词搜索、L0 abstract / L1 overview / L2 full 三级读取。

对我们来说，长期记忆可以先放飞书文档，让人可见、可编辑、可审计；本地只保存索引、摘要、缓存和引用关系。

### 论文和系统启发

- **Generative Agents**：提出 memory stream，并用 recency、importance、relevance 检索，再通过 reflection 和 planning 产生更高层经验。适合 Root Agent 观察群聊、总结人和项目的长期模式。
- **Reflexion**：把失败或反馈转成 verbal reflection，下一次尝试时读入。适合让 Root Agent 对误报、打扰、不合适回复做复盘。
- **MemGPT**：把 LLM 上下文看成虚拟内存，区分可直接访问的主上下文和外部长期存储。适合我们把飞书文档作为外部记忆，本地 context builder 负责换入换出。
- **Voyager**：把学到的能力沉淀成 skill library，并用 automatic curriculum 主动探索。适合把常用飞书/代码/文档流程沉淀成 SOP。
- **A-MEM**：用类似 Zettelkasten 的方式让新记忆主动和旧记忆建立链接。适合跨项目、跨群、跨人的关联提醒。
- **Agent memory survey**：把记忆看成存储、检索、利用、更新的闭环，而不是单纯 RAG。

## 核心角色

### 1. Root Agent

Root Agent 是这个系统的中心，也就是“我的分身”。飞书里不需要额外约定特殊名字，用户只要 @ 这个 bot，事件就交给 Root Agent 判断。

它只有一个长期身份和一个长期主 session，不随飞书 thread 重置。它负责：

- 观察所在群的消息。
- 判断消息是否和王毅有关。
- 被 @ 时公开回复。
- 未被 @ 时不在群里回复，只在需要时私聊王毅。
- 维护人、项目、偏好、任务、经验记忆。
- 决定是否调用 Codex/Claude Code 干活。
- 对执行结果做归纳、复盘、更新记忆。

Root Agent 的输出通道有严格边界：

| 场景 | 行为 |
| --- | --- |
| 私聊 bot | 可以直接回答和执行 |
| 群里 @ bot | 由 Root Agent 判断是否直接回答、委派 worker、或先澄清 |
| 群里未 @ bot | 不在群里回复 |
| 群里未 @ 但判断王毅需关注 | 私聊王毅，附原因、原消息链接、建议动作 |
| 高风险动作 | 私聊王毅确认 |

### 2. 执行 Agent：Codex / Claude Code

Codex 和 Claude Code 变成 Root Agent 可调用的工具：

- Codex：代码修改、测试、review、安全审查、仓库操作。
- Claude Code：代码实现、长上下文理解、文档整理、方案生成。
- Debate：不是用户显式 `/debate` 才能用；Root Agent 可以自然语言发起“让 builder 和 reviewer 讨论一下”。
- Review：Root Agent 可以在执行前后自动调用 reviewer。

执行 Agent 仍然按飞书 thread 和 workspace 维护自己的 session。它们是 task session，不是 Root Agent 的人格记忆。

### 3. 人类 Owner：王毅

Owner 是最终决策者。Root Agent 可以主动 push，但不能偷偷替 Owner 做不可逆决策。

Owner 控制：

- 哪些群可观察。
- 哪些群可公开回复。
- 哪些类型的事情需要私聊提醒。
- 哪些动作可自动执行。
- 哪些动作必须确认。

## 总体架构

```text
Feishu Groups / DMs
  ↓
Event Intake
  ↓
Observer Inbox  ── Mention Router ── Command Router
  ↓                         ↓
Root Agent Always-on Loop  Direct Reply Flow
  ↓
Attention Classifier
  ├─ ignore
  ├─ remember only
  ├─ DM owner
  ├─ reply in thread
  └─ delegate work
        ↓
  Work Order Store
        ↓
  Codex / Claude Code / Debate / Review
        ↓
  Result Synthesizer
        ↓
Memory Writer + Activity Ledger + Follow-up Scheduler
```

## 事件处理策略

### 群消息默认静默观察

当前项目已经支持 `require_mention_in_group = true`，这对公开回复是正确的。但下一阶段要区分两件事：

- **公开触发**：只有 @、thread reply、显式命令才允许在群里回复。
- **观察触发**：授权群的非 @ 消息也进入 observer inbox，但只能用于分类、记忆和私聊提醒。

也就是说，未 @ 的群消息不该进入当前 Claude/Codex 普通回复队列，而应该进入 Root Agent 的观察队列。

### Attention Classifier

Root Agent 需要先做一个轻量分类：

```json
{
  "visibility": "silent_observe",
  "relevanceToOwner": 0.82,
  "reason": "王毅被提到，且讨论的是他参与的项目",
  "action": "dm_owner",
  "urgency": "normal",
  "needsDelegation": false,
  "memoryCandidates": [
    "欧仕刚认为主动员工 Agent 对内部铺开有价值"
  ]
}
```

动作集合：

| action | 含义 |
| --- | --- |
| `ignore` | 完全忽略 |
| `remember_only` | 只沉淀记忆，不打扰 |
| `dm_owner` | 私聊王毅提醒 |
| `ask_owner` | 私聊王毅请求确认 |
| `reply_thread` | 只有被 @ 或 thread 内追问时可用 |
| `delegate` | 创建 work order 给 Codex/Claude Code |

### 私聊提醒格式

私聊不是“转发所有消息”，而是只发可行动摘要：

```text
我觉得这条你可能要看一下：

来源：Osgood, 王毅 群
原因：他们在讨论你参与的主动员工 Agent 方向，并提到需要你补上下文。
建议：可以回复项目边界，或者让我先整理一版技术方案。

原消息：<飞书消息链接>
```

## Root Agent 常驻循环

借鉴 cryochamber 的纪律性，但不采用“退出后等待下一次触发”的运行形态。Root Agent 在本机常驻，核心是一个 always-on event loop：

```text
observe
  ↓
orient
  ↓
classify inbox
  ↓
act / delegate / wait
  ↓
record memory
  ↓
schedule / update timers
  ↓
idle
```

Root Agent 的进程不退出，空闲时只保持飞书长连接、watch 本地状态文件、处理到期 timer。重型模型调用只在有事件、TODO 到期、或 worker 结果返回时触发。

### Orient

每次处理事件前读取：

- 当前时间。
- pending inbox。
- pending TODO。
- active work orders。
- 最近私聊/群聊摘要。
- Root Agent 记忆索引。
- 最近一次自我复盘。

### Work

Root Agent 可以做的事情：

- 私聊提醒王毅。
- 回复 @ 它的群消息。
- 创建/更新 TODO。
- 调用 Codex/Claude Code。
- 整理飞书文档。
- 更新记忆。

### Record

每次事件循环处理结束前都要记录：

- 这次处理了哪些 inbox。
- 是否提醒了王毅。
- 是否回复了群。
- 是否创建了 work order。
- 是否学到了新记忆。
- 有无误报/漏报风险。

### Schedule

Root Agent 不需要休眠，但仍然需要 scheduler。scheduler 的意义不是让 Agent 醒来，而是让常驻进程在合适时间触发下一次轻量检查或重型模型调用：

- 等待人类回复：30 分钟或更久。
- 等待执行 Agent：1-5 分钟轮询。
- 等待 CI/测试/外部结果：15-30 分钟。
- 日常巡检：每天固定时间。
- 无 pending 任务：不跑模型，只继续监听飞书事件。

## 会话模型

这里要明确三类 session，避免混乱。

### 1. Root Agent session

全局一个，长期存在。它承载“王毅分身”的人格、经验和长期记忆。

特点：

- 不按飞书 thread 重置。
- 主要读写 memory docs、activity ledger、attention policy。
- 只做协调、判断、总结和委派。

### 2. 飞书 thread session

每个飞书 thread 一个 conversation scope。用于保持当前话题上下文。

特点：

- 被 @ 后公开回答时使用。
- 记录该 thread 的消息摘要和处理状态。
- 可以关联多个 work order。

### 3. Worker session

Codex/Claude Code 的执行 session。

特点：

- 绑定 workspace。
- 绑定 task/thread。
- 可以复用 Codex thread id 或 Claude session id。
- 结束后把结果交还 Root Agent，由 Root Agent 决定怎么回复人类、是否更新记忆。

## Root Agent 模型配置

Root Agent 需要快、稳、上下文窗口足够大。推荐单独配置一个 provider，不复用 Codex/Claude Code 的 CLI 配置。

示例配置只放占位符；真实密钥必须来自本机私有配置或环境变量，不能提交到仓库：

```toml
[root_agent.model]
provider = "bedrock"
model = "us.anthropic.claude-sonnet-4-6"
region = "us-east-1"
max_tokens = 16384

[root_agent.model.env]
AWS_ACCESS_KEY_ID = "${AWS_ACCESS_KEY_ID}"
AWS_SECRET_ACCESS_KEY = "${AWS_SECRET_ACCESS_KEY}"
```

Root Agent 的模型职责：

- attention classification。
- 群消息静默观察和私聊提醒决策。
- 记忆检索和上下文组装。
- worker 委派和结果综合。
- 自我复盘和记忆候选生成。

Worker 的模型职责：

- Codex/Claude Code 继续走各自 CLI 和 workspace session。
- Root Agent 只把任务、约束、上下文包、期望输出交给 worker。
- Worker 结果先回到 Root Agent，不直接决定是否群发。

## 记忆设计

我不建议只用传统“三层记忆”命名。更适合主动员工 Agent 的是“按用途分区 + 三级读取”。

记忆和上下文压缩必须一起设计。Root Agent 只有一个长期 session，如果只是不断追加聊天历史，迟早会丢上下文；如果粗暴摘要，又会丢掉人、项目、决策和未完成事项。正确做法是让压缩过程产生可追溯的索引和记忆引用，而不是把旧上下文揉成一段不可恢复的摘要。

### 按用途分区

| 记忆类型 | 内容 | 存储建议 |
| --- | --- | --- |
| Working Context | 当前活跃任务、最近 thread、待办 | 本地 JSON + 卡片 |
| Episodic Memory | 发生过的事件、对话、决策过程 | 飞书文档日报/周报 |
| Semantic Memory | 稳定事实：项目、人、术语、偏好 | 飞书文档分目录 |
| Procedural Memory | SOP、工具用法、踩坑经验 | 飞书文档 + 本地 skill |
| Social Memory | 人和群的偏好、角色、关系 | 飞书文档 |
| Reflective Memory | 复盘、原则、误报/漏报教训 | 飞书文档 |

### 三级读取

借鉴 Shrimp/OpenViking 的 L0/L1/L2：

| 层级 | 作用 | 示例 |
| --- | --- | --- |
| L0 abstract | 检索列表里的一句话 | “欧仕刚关注主动员工 Agent 的内部铺开。” |
| L1 overview | 注入 prompt 的短摘要 | “这个群讨论过自驱 bot、cryochamber、飞书 inbox、流式卡片。” |
| L2 full | 必要时读取全文 | 完整会议/群聊/项目记录 |

### 飞书文档目录结构

建议启动时创建或绑定一个根目录：

```text
主动员工 Agent 记忆库/
  00_Profile_and_Policy
  01_People
  02_Groups
  03_Projects
  04_Episodes
  05_Reflections
  06_SOP_and_Skills
  07_Work_Orders
  08_Daily_Weekly_Reports
```

本地保存 `memory-index.jsonl`：

```json
{
  "id": "mem_...",
  "docUrl": "https://...",
  "path": "03_Projects/feishu-agent-bridge",
  "abstract": "feishu-agent-bridge 是王毅的飞书到本地 Agent 桥接项目",
  "tags": ["project", "feishu", "agent"],
  "updatedAt": "2026-06-29T22:20:00+08:00"
}
```

后续如果需要向量检索，可以把 abstract/overview 做 embedding；第一版也可以先用关键词 + 最近度 + 标签。

### 记忆写入原则

不是所有消息都写长期记忆。写入条件：

- 用户明确表达长期偏好。
- 项目事实发生变化。
- 某个人的角色或责任被确认。
- 产生了可复用 SOP。
- Agent 犯错或被纠正。
- 多次出现的模式值得总结。

## 上下文压缩设计

Root Agent 的上下文压缩参考 Shrimp 的 ContextManager，但要适配飞书和长期常驻场景。

### 压缩目标

- 最近正在处理的消息不能丢。
- 人名、群名、项目、权限、未完成任务不能丢。
- worker 的完整输出不必每次都塞进 prompt，但必须能按 id 找回。
- 摘要必须带来源链接，避免模型把压缩摘要当成无出处事实。
- 每次压缩都要可审计：知道哪些原始消息被压成了哪条 summary。

### 上下文层级

| 层级 | 内容 | 保留方式 |
| --- | --- | --- |
| L0 Live Window | 当前事件、最近 thread、最近私聊、active work order | 原文保留 |
| L1 Working Summary | 最近一段时间的群/私聊/worker 结果摘要 | 结构化摘要，带 message/work-order id |
| L2 Memory Index | people/projects/groups/SOP/reflection 的 abstract/overview | 从飞书文档索引检索 |
| L3 Recoverable Archive | 完整历史消息、worker 完整输出、飞书文档全文 | 按 id/link 延迟加载 |

### 压缩单元

不要按 token 长度机械截断，而是按语义单元压缩：

- 一个飞书 thread。
- 一次 Root Agent 事件循环。
- 一个 work order。
- 一次 worker 执行。
- 一组连续群消息。
- 一个项目阶段。

每个压缩单元生成：

```json
{
  "id": "ctx_...",
  "kind": "thread_summary",
  "scopeId": "oc_xxx:omt_xxx",
  "sourceIds": ["om_1", "om_2", "wo_3"],
  "summary": "这段讨论确认了 observer inbox 必须静默观察，只有 @ bot 才能群内回复。",
  "facts": [
    "Root Agent 默认不在未 @ 群消息中公开回复",
    "Codex/Claude Code 是 Root Agent 的 worker"
  ],
  "openLoops": [
    "需要实现 observer-inbox.jsonl 和 owner DM 提醒"
  ],
  "memoryRefs": ["03_Projects/feishu-agent-bridge"],
  "createdAt": "2026-06-29T22:40:00+08:00"
}
```

### 压缩流程

1. 新事件到来，先构造 live context。
2. 从 memory index 检索 L0 abstract 和 L1 overview。
3. 从 `context-summaries.jsonl` 读取相关 thread/work-order 摘要。
4. 如果摘要不足，再按 `sourceIds` 拉取原文。
5. Root Agent 处理完成后，生成新的 context summary。
6. 记忆候选进入 pending review 或直接写入低风险记忆区。

### 防止压缩丢关键信息

压缩器必须显式抽取以下字段：

- people：谁说的、谁被提到、谁负责。
- projects：涉及哪个项目或仓库。
- decisions：已经确定的决策。
- constraints：权限、安全、时间、预算、开源边界。
- open loops：未完成事项、等待谁、何时提醒。
- source links：飞书 message link、doc link、work order id。
- confidence：确定事实和推测分开。

任何没有 source link 的长期事实，都只能作为 hypothesis，不能写成 confirmed memory。

### 本地状态文件

第一版可以不引入数据库：

```text
~/.feishu-agent-bridge/
  root-session.json
  observer-inbox.jsonl
  activity.jsonl
  work-orders.jsonl
  todos.json
  context-summaries.jsonl
  memory-index.jsonl
```

后续如果状态量变大，再迁移 SQLite。开源版本不需要一上来引入外部数据库。

## 委派模型

Root Agent 可以把任务变成 work order：

```json
{
  "id": "wo_...",
  "source": {
    "chatId": "oc_...",
    "messageId": "om_...",
    "threadId": "omt_..."
  },
  "owner": "ou_wangyi",
  "assignee": "codex",
  "workspace": "/Users/dp/work/wangyi/github/feishu-agent-bridge",
  "task": "检查 observer inbox 设计是否会导致群聊误回复",
  "expectedOutput": "风险列表、建议补丁、测试建议",
  "status": "running"
}
```

### 自然语言委派

用户可以说：

```text
@这个 bot 让 Codex 看一下这个 PR 有没有权限问题
```

Root Agent 解析后创建 work order，并调用 Codex。

Root Agent 自己也可以判断：

```text
这条消息涉及代码风险，我先让 Codex 做一轮 review，再把结果发给你。
```

### Debate 作为内部工具

`/debate` 可以保留，但更重要的是 Root Agent 能内部发起：

```text
请 builder 和 reviewer 围绕“是否要默认观察群消息”讨论 3 轮。
输出：结论、风险、需要 owner 决策的问题。
```

输出不应该只是两段长文本，而要结构化：

```json
{
  "decision": "allow_silent_observe_only",
  "risks": ["隐私边界", "误报打扰", "消息量成本"],
  "guardrails": ["不公开回复", "只观察授权群", "每日提醒限额"],
  "needsOwnerDecision": ["哪些群默认启用观察"]
}
```

## 配置草案

```toml
[root_agent]
enabled = true
name = "Root Agent"
owner_open_id = "ou_xxx"
main_session_id = "main"
default_workspace = "/Users/dp/work/wangyi"

[observe]
enabled = true
silent_group_observe = true
public_reply_requires_mention = true
dm_owner_when_attention_score_above = 0.75
max_owner_dm_per_day = 8
quiet_hours = "23:30-08:30"

[memory]
backend = "feishu_docs"
root_doc_url = ""
local_index_path = "~/.feishu-agent-bridge/memory-index.jsonl"
write_back = true
extract_after_each_session = true

[scheduler]
enabled = true
tick_interval_seconds = 30

[[workers]]
name = "codex"
kind = "codex"
role = "code reviewer and implementer"

[[workers]]
name = "claude"
kind = "claude"
role = "builder, explainer, document writer"
```

## 命令草案

| 命令 | 作用 |
| --- | --- |
| `/agent status` | 查看 Root Agent 状态、pending inbox、pending TODO、active work orders |
| `/agent observe on|off` | 开关当前群静默观察 |
| `/agent policy` | 查看当前群触发/提醒策略 |
| `/todo list` | 查看 Root Agent TODO |
| `/todo add <内容> at <时间>` | 添加定时任务 |
| `/memory search <关键词>` | 查记忆 |
| `/memory write <路径> <内容>` | 手动写记忆 |
| `/delegate codex <任务>` | 显式委派 Codex |
| `/delegate claude <任务>` | 显式委派 Claude Code |

同时保留自然语言入口：

```text
@这个 bot 这事你盯一下，明天上午提醒我
@这个 bot 让 Codex 检查一下这个仓库有没有开源前风险
@这个 bot 你和另一个 Agent 讨论下这套架构怎么做
```

## 实施里程碑

### M1：Observer Inbox

- 授权群的非 @ 消息进入 `observer-inbox.jsonl`。
- 未 @ 时绝不群内回复。
- Attention classifier 先用规则 + LLM 小模型均可。
- 高分消息私聊 owner，附原消息链接和原因。
- 加端到端测试：群未 @ 不回复，私聊 owner 可触发。

### M2：Root Agent Always-on Loop

- 新增 `RootAgentOrchestrator`。
- Root Agent 有单独 session，不按 thread 重置。
- Root Agent prompt 固定包含 owner profile、policy、pending inbox、pending TODO、memory abstract。
- 进程常驻；一次事件处理结束必须写 activity ledger，可选设置 TODO/timer，然后回到 idle。

### M3：TODO Scheduler

- 本地 `todos.json`，字段包括 scope、source、at、status、reason。
- tick 到期后生成 internal inbox。
- `/stop` 可以取消当前 scope 的 active run 和 pending TODO。
- 崩溃/重启后恢复 pending TODO。

### M4：Feishu Docs Memory

- 初始化或绑定记忆库根文档/目录。
- 写入 people/projects/groups/reflections/SOP。
- 本地 `memory-index.jsonl` 保存 L0 abstract、tags、docUrl。
- 每次 Root Agent 循环结束后异步抽取记忆候选，先写到 pending review，避免乱写长期记忆。

### M5：Worker Delegation

- 新增 work order store。
- Root Agent 可调用 Codex/Claude Code。
- Worker 输出回到 Root Agent，不直接越权群发。
- `/review` 和 `/debate` 迁移为 work order 的两种模板。

### M6：Context Compression

- 借鉴 Shrimp：最近 raw、较早 structural summary、更早 L0/L1 doc memory。
- 工具结果和 worker 结果先做 descriptor，必要时再加载全文。
- 让 Root Agent 的单一长期 session 可以稳定运行，不被历史撑爆，也不因粗暴摘要丢关键上下文。

### M7：Skill Library 和自我改进

- 常用任务沉淀为 SOP。
- 失败/误报写入 reflective memory。
- 每周生成一份“我学到了什么/我打扰得是否合理”的复盘文档。

## 开源边界

开源版本建议保留通用能力：

- 飞书事件接入。
- Observer inbox。
- Root Agent always-on loop。
- TODO scheduler。
- Worker delegation。
- 本地 JSON/JSONL 状态。
- 可选 Feishu Docs memory backend。

不要把个人 open_id、私有文档 URL、内部 API token、公司群策略写进仓库。示例配置只放占位符。

## 最小可用版本

我建议第一阶段不要急着做完整记忆库，先做一个能明显体现“分身”的闭环：

1. Bot 被拉进授权群。
2. 群里未 @ 时不回复。
3. 群里出现“王毅/项目/需要关注”的消息时，Bot 私聊王毅。
4. 王毅在私聊里说“你处理一下”，Root Agent 创建 work order 给 Codex/Claude。
5. Worker 完成后，Root Agent 总结给王毅。
6. Root Agent 把这次经验写入 activity ledger 和一条 reflection。

这个闭环跑通后，再逐步加 Feishu Docs memory、压缩、长期 TODO 和多 Agent debate。它比一上来做“大而全主动员工平台”更稳，也更容易端到端测试。
