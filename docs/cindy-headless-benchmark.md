# Cindy Headless 开发设计文档

## 1. 文档目的

本文定义 Cindy 在 Harbor/Terminal-Bench 评测环境中的无界面运行形态 `cindy-headless`，说明：

- Cindy harness 的组成和测试边界；
- headless 运行时需要实现的组件；
- 首期明确不做的能力和后续扩展方向；
- Harbor 运行时、结果文件和审计产物；
- 分阶段开发、测试方法和验收标准。

本文是 Issue #127 的开发设计基线。它不是 Cindy Desktop 的重构方案，也不把 Desktop UI 搬进容器。

## 2. 背景与问题

Issue #127 的目标是建立 same-model harness benchmark，比较：

1. 同一模型下 Cindy 不同配置的差异；
2. 同一模型下 Cindy 与 Claude Code、Codex CLI、Kimi Code 等 agent 的 harness 差异。

每个 paired cell 必须使用相同的：

```text
model route + task container + task + repetition + deadline + 资源限制
```

因此不能直接拿 Desktop 中运行的 Cindy 与容器中的 CLI 比较。Desktop 额外拥有 Electron、数据库、UI、系统凭证和本机工具，这会破坏实验边界。

需要一个在 Harbor task container 内运行、可审计、可复现、没有 Electron 依赖的 Cindy 入口。

## 3. 核心目标

### 3.1 首期必须达到

- 在 Harbor task container 内运行 Cindy harness；
- 复用 `packages/maker-core` 的 Agent 编排和事件模型；
- 支持至少一个冻结的 Cindy production snapshot，例如 `cindy-production-claude-<date>`；
- 支持精确模型 ID、provider、endpoint、thinking/reasoning 配置；
- 将任务 instruction 作为一次 Cindy turn 输入；
- 让 Agent 使用容器中的工作目录、工具和文件；
- 产出完整、可追溯、脱敏的 trace、usage、版本和 reward；
- timeout、认证失败、网络错误、基础设施错误与普通任务失败分开统计；
- 能通过 Harbor 的标准 verifier 和 reward 机制；
- 在同一个 task container 契约下与外部 agent 对比。

### 3.2 不是首期目标

- 在容器内复刻 Cindy Desktop UI；
- 让 Electron 在 Linux task container 中启动；
- 将 Desktop 数据库、IPC、BrowserWindow 或系统凭证存储带入 benchmark；
- 重新实现 Claude/Codex Agent Loop；
- 通过人工 prompt 修改弥补运行时缺陷；
- 为了取得更高分数修改 verifier、删题或事后换模型。

## 4. Cindy harness 的定义

本项目中的 harness 是“模型之外，决定 Agent 如何接收任务、使用工具、维护上下文、处理权限和结束会话的连接与编排层”。

但 Cindy 不是从零实现 Agent Loop。为了避免把底层 Claude Code 的能力错误归因给 Cindy，报告必须把运行栈拆成三层：

| 层 | 典型内容 | 是否属于 Cindy 增量 |
|---|---|---:|
| Vendor base harness | Claude Code/Codex 的原生 Agent Loop、内置工具、原生 compaction、原生 subagent | 否 |
| Cindy core overlay | `maker-core` 会话编排、Cindy prompt、provider/proxy 路由、权限策略、MCP 注入、事件翻译、usage 归一化 | 是 |
| Desktop product surface | Electron UI、IPC、数据库、IM、Scheduler、插件、设备和本机 GUI 能力 | 首期不测 |

因此，`cindy-headless` 的分数代表“Vendor base harness + Cindy core overlay”的整体效果。若要说明 Cindy 自身带来的增量，必须增加同版本、同模型的 raw vendor arm 做消融对照，不能只拿 Cindy 与另一个完全不同的 Agent 比较。

### 4.1 纳入 Cindy harness 的能力

| 能力 | 归属 | 首期是否测试 | 说明 |
|---|---|---:|---|
| Session 创建、发送 turn、关闭 | `maker-core` | 是 | Cindy 的基本会话生命周期 |
| Claude Code/Codex backend 连接 | Vendor + `maker-core` | 是，先 Claude | 报告中分别记录 vendor base 与 Cindy overlay |
| model/provider/endpoint 路由 | headless host + `maker-core` | 是 | 必须记录精确 route |
| Cindy system prompt | profile/host | 是 | 记录 digest，不在公开报告暴露正文 |
| tool surface 和 MCP | host + `maker-core` | 是 | 先使用声明过的最小集合 |
| permission mode | host/profile | 是 | benchmark 中通常为容器内自动执行模式 |
| event translator | `maker-core` | 是 | 影响工具调用、错误和结果观察 |
| context compaction | Vendor + `maker-core` | 是 | 分别记录原生与 Cindy 触发的 compaction |
| token/cache/usage 计量 | `maker-core` + trace adapter | 是 | 用于成本和性能分析 |
| 子 Agent/subagent 策略 | backend/profile | 条件纳入 | 只有 profile 明确开启并记录模型时才纳入 |
| 工作目录和终端工具 | Harbor container | 是 | 所有 paired arms 使用同一容器契约 |
| project-context | Cindy Desktop 集成 | 首期否 | Terminal-Bench 默认没有 Cindy 项目知识库；后续可做独立变量 |
| Maker Memory | Desktop host 注入 | 首期默认否 | 避免把跨题持久状态带入 benchmark |

### 4.2 不属于首期 harness 的 Desktop 能力

以下能力可以存在于 Cindy 产品中，但默认不进入首期 production snapshot：

- Electron UI、Renderer、BrowserWindow、IPC；
- Desktop local DB、sessions 持久化和本机 userData；
- 系统 Keychain、Claude Desktop OAuth UI 和账号切换界面；
- 飞书/Discord/微信等 IM 入口；
- Scheduler、Orca 多 Agent 产品编排；
- Desktop 插件 UI 和插件市场；
- 远程 SSH host、cc-manager 和远程文件服务；
- Desktop 专属 browser、媒体和本机 GUI MCP；
- 用户个人 Memory、联系人、附件 UI 和设备连接；
- 只影响展示的通知、标题、状态动画和 Agent Island。

这不是说这些能力永远不测，而是它们必须作为独立 profile 或独立 benchmark 设计，不能隐式混入基础 harness 分数。

### 4.3 必需的归因对照组

首个正式 same-model 实验建议至少包含：

```text
Arm A: raw Claude Code（固定 binary/version/model）
Arm B: Cindy Headless over 同一个 Claude Code（只增加 Cindy overlay）
Arm C: Kimi Code 或其他外部 Agent（同一精确 model route）
```

- A vs B：回答 Cindy overlay 带来了什么变化；
- B vs C：回答完整 Cindy harness 与外部 harness 的差异；
- A vs C：提供底层 vendor harness 参照。

没有 Arm A 时，B vs C 的差异不能被直接解释为“Cindy 增量”。

## 5. 总体架构

```text
Harbor Job/Trial
  |
  |  instruction, task container, model, env, deadline
  v
Harbor CindyHeadlessAgent (Python)
  |
  |  environment.exec("cindy-headless run ...")
  v
cindy-headless CLI (Node.js)
  |
  +-- profile loader + config digest
  +-- secret/env adapter
  +-- shared production profile snapshot
  +-- headless host
  |     +-- AgentRuntimeConfig
  |     +-- AuthAdapter
  |     +-- MCP provider set
  |     +-- logger / trace writer
  |     +-- cancellation / deadline
  |
  v
@cindy/maker-core
  +-- Maker
  +-- ClaudeCodeAgent or CodexAgent
  +-- Session
  +-- AgentEvent translator
  +-- usage / cache / compaction
  |
  v
Optional Cindy compatibility proxy (profile-controlled)
  |
  v
Official agent binary + exact model route
  |
  v
Harbor verifier -> reward -> normalized result
```

关键原则：

1. `cindy-headless` 是 host 和入口，不是第三套 Agent Loop；
2. 会话、事件、权限和 usage 语义尽量由 `maker-core` 统一提供；
3. Desktop 与 Headless 不能各自复制一份 prompt/runtime 配置；
4. 对非 Anthropic 模型，若 production 会经过 `anthropic-compat-proxy`，Headless 必须走同一转换链路，否则不构成 production parity。

## 6. 组件设计

### 6.1 `cindy-headless` CLI

建议位置：`apps/cindy-headless/`。

该 app 应构建为可复制进 Linux 容器的独立产物，例如单文件 JS bundle + manifest，不能要求在每个 Harbor trial 中 checkout 整个 Cindy monorepo 后执行 `pnpm install`。构建产物必须携带 Cindy commit、lockfile digest 和依赖清单。

建议命令：

```bash
cindy-headless run \
  --profile /config/cindy-production-claude-<digest>.json \
  --workdir /app \
  --instruction-file /tmp/instruction.txt \
  --trace /logs/agent/trace.jsonl \
  --result /logs/agent/result.json
```

首期 CLI surface 保持小而确定：

| 命令 | 作用 | 是否调用模型 |
|---|---|---:|
| `cindy-headless version --json` | 输出 headless/Cindy/Agent binary 版本和 build digest | 否 |
| `cindy-headless doctor --profile ...` | 检查 binary、profile、endpoint 配置和可写目录 | 默认否 |
| `cindy-headless profile validate ...` | schema、模型支持和 digest 校验 | 否 |
| `cindy-headless capabilities --profile ...` | 输出声明的 backend/model/tool/MCP 能力 | 否 |
| `cindy-headless run ...` | 执行一个 Harbor task turn | 是 |

Cell expansion、随机排序、统计报告属于 benchmark runner，不放进 Headless CLI，避免运行时和实验编排耦合。

CLI 职责：

1. 读取 instruction，不从命令行拼接长文本；
2. 加载 profile 并校验 schema；
3. 从环境变量读取 secret，不接受把 key 写进 profile；
4. 构造无 Electron 的 host dependencies；
5. 创建 Session 并发送一条初始 user turn；
6. 将统一 AgentEvent 写成 JSONL；
7. 监听结束、错误、abort 和 deadline；
8. 输出版本、配置 digest、usage、结束原因和退出码；
9. 在 session 启动前原子写入 `identity.json`，运行中持续 flush trace，保证被 deadline 强杀后仍有可审计信息；
10. 在 `finally` 中关闭 session、子进程、loopback proxy 和临时资源。

建议退出码：

| 退出码 | 语义 |
|---:|---|
| 0 | Agent 正常结束，交给 verifier 判定任务是否完成 |
| 20 | Agent deadline/timeout |
| 30 | 认证、模型或 provider 配置错误 |
| 40 | 网络/API 临时错误 |
| 50 | headless/runtime 基础设施错误 |

模型拒绝、模型给出错误答案、Agent 主动表示无法完成等都属于有效 attempt，CLI 应正常退出并交给 verifier 判定，不能归类成 infra-invalid。只有执行链路本身无法成立时才使用非零基础设施退出码。

`deadline-killed` 也是 benchmark 观察结果，不是 infra-invalid：它进入 finished-in-time 指标并按预注册规则计为未通过。认证缺失、镜像损坏、route mismatch、Harbor/provider 基础设施故障才属于 infra-invalid，可按预注册策略补跑。

### 6.2 Headless host

headless host 是 Desktop `maker-host` 的最小无 Electron 对应物。它只实现 `maker-core` 所需的抽象依赖：

- `binaryPath`：容器中的固定 Agent binary；
- `runtimeConfig`：system prompt、endpoint、model/compaction 配置；
- `AuthAdapter`：从容器环境变量读取凭证；
- compatibility proxy：profile 要求时复用 `packages/anthropic-compat-proxy`，并记录上游/loopback route；
- `logger`：写入 `/logs/agent`，禁止写 secret；
- MCP provider registry：只注册 profile 声明的 provider；
- 文件和工作目录能力：直接使用 Harbor 的 `/app`；
- memory：首期关闭或使用一次性临时目录；
- session storage：注入明确的 ephemeral/in-memory 实现，不使用 Desktop DB，且每个 trial 使用独立目录；
- cancellation：连接 Harbor deadline 和进程 signal。

Secret 必须以 endpoint/credential pair 注入，Headless 在调用前校验二者属于同一 profile route。只提供内部 proxy key 却缺少对应 base URL 时必须 fail-fast，禁止悄悄请求官方 endpoint。任何 doctor/debug 输出只能显示来源和布尔状态，不能显示 secret 值。

首期建议只实现 Claude Code host。Codex host 作为第二阶段能力，不能因为接口预留就宣称已支持。

实现前必须建立一份 Desktop host parity matrix，对 `AgentDeps`、`MakerDeps` 和 session create options 的每个字段逐项标记：

| 状态 | 含义 |
|---|---|
| shared | Desktop 与 Headless 使用同一纯实现 |
| headless-ephemeral | Headless 使用 trial 级临时实现 |
| explicitly-disabled | profile 明确关闭并进入 digest |
| unsupported | plan 阶段拒绝，不能静默忽略 |

Headless 构造代码应使用完整类型约束，`maker-core` 新增必需依赖时让编译或 contract test 失败，防止 Desktop 已接入而 Headless 静默缺失。

#### Production parity 配置源

当前 Desktop 的 system prompt、runtime config 和 provider/proxy 组装位于 Desktop host。Headless 不应复制这些内容。建议抽出一个零 Electron 的共享模块（名称可在实现阶段确定，例如 `packages/cindy-agent-profile`），由 Desktop host 和 Headless host 同时消费：

- production system prompt 原文和固定拼接顺序；
- tool/MCP 声明与启用规则；
- provider route 和 compatibility proxy 规则；
- compaction、memory、subagent 等默认值；
- 生成 profile snapshot 与 digest 的纯函数。

提取时不得顺便修改 prompt 内容。仓库规则要求 system prompt 改动先取得 owner 确认；纯搬迁也必须通过字节级 prompt parity test，证明 Desktop 改造前后最终 prompt digest 不变。

### 6.3 Harbor Agent adapter

建议位置：`benchmarks/harbor/agents/cindy_headless.py`。

它实现 Harbor `BaseAgent`/`BaseInstalledAgent` 契约：

- `name()` 返回 `cindy-headless`；
- `version()` 返回 Cindy commit 或 headless package version；
- `setup()` 检查 headless CLI、Agent binary 和 profile；
- `run()` 将 instruction 写入临时文件，调用 `cindy-headless run`；
- 将 stdout/stderr/trace/usage 同步到 Harbor agent logs；
- 将 headless 退出码映射为 Harbor 的异常分类；
- 填充 Harbor `AgentContext` 的 input/cache/output/cost；
- 保持每次 trial 的日志隔离，不使用跨 trial 工作目录。

该 adapter 不应该重新处理模型协议、拼接 system prompt 或解析 Claude 原始事件；这些职责属于 headless host 和 `maker-core`。

Adapter 自身运行在 Harbor host 侧，而 `cindy-headless` 必须在 task environment 内可执行。`setup()` 应把已构建、已校验 digest 的 headless bundle 安装到 `/installed-agent/cindy-headless`，或验证共同 benchmark image 中已有同一产物；不能引用 Windows 宿主路径，也不能在 trial 中从浮动 `main` 下载源码。

### 6.4 Profile 与配置指纹

Profile 是 benchmark 的实验输入，不是用户动态设置。

建议字段：

```yaml
id: cindy-production-claude-v1
cindy_commit: <40-char-sha>
headless_version: <semver>
agent_backend: claude-code
agent_binary_version: 2.1.220
model:
  provider: tapsvc
  requested_id: <exact-model-id>
  expected_effective_id: <exact-model-id>
  route_id: <stable-route-id>
  endpoint_digest: <endpoint-config-digest>
  context_limit: <integer>
  thinking_budget: <integer-or-fixed-mode>
  enforcement:
    context_limit: <cli-flag|provider-contract|observed-only>
    thinking_budget: <cli-flag|env|provider-contract>
compatibility_proxy:
  enabled: true
  version: <package-version-or-commit>
permission_mode: bypassPermissions
tools:
  vendor_builtin: [bash, read, write, edit, ...]
  cindy_overlay: []
  mcp: []
memory:
  maker: false
  native: false
compaction:
  enabled: true
  threshold_pct: 80
```

运行时生成：

- `profile_digest`；
- `system_prompt_digest`；
- `tool_surface_digest`；
- `model_route_digest`；
- `container_image_digest`。

公开报告只保存 digest 和必要元数据，不保存 API key、完整 prompt 或私有凭证配置。

Profile 校验必须在模型调用前完成，并满足：

- Harbor `--model`、profile `requested_id` 和实际 Agent spawn 配置一致；
- provider 不支持该模型时直接拒绝 plan，不允许 fallback；
- context/thinking 参数无法真实约束时必须标记 `observed-only`，不能把目录元数据当作已执行约束；
- 运行结束后从原始响应/trajectory 记录 observed effective model；
- requested 与 observed 不一致时，该 attempt 标记为 `infra-invalid:model-route-mismatch`，不能进入普通 reward 统计。

### 6.5 Trace 与结果格式

每次 trial 至少保存。文件由 Headless 写入 `/logs/agent`，再由 Harbor 同步到 trial 目录，避免 Headless 自行发明第二套根目录：

```text
trial/
  config.json
  agent/
    stdout.jsonl
    stderr.log
    trace.jsonl
    trajectory.json
    result.json
  verifier/
    reward.txt
    ctrf.json
    test-stdout.txt
  artifacts/
    manifest.json
```

Trace 事件至少包括：

- session start/end；
- user instruction 摘要或 hash；
- assistant text；
- thinking 元信息（如果 provider 允许）；
- tool call/tool result；
- permission decision；
- compaction boundary；
- usage snapshot；
- API/网络错误；
- timeout/abort；
- final exit reason。

不得把 API key、OAuth token、完整 Authorization header 或未脱敏环境变量写入 trace。

Usage 必须保留两层口径：

- `raw_provider_usage`：供应商/Agent 原始字段，原样脱敏保存；
- `normalized_usage`：Cindy/Harbor 用于跨 Agent 报告的 input、cache-read、cache-create、output、cost。

归一化不能覆盖原始数据，也不能把 cache token 重复计入 input。报告必须声明每个 provider 的计量定义和缺失字段。

## 7. Production snapshot 定义

`cindy-production` 不是一个天然稳定的配置：Desktop 会随用户设置、provider 连接、backend、模型目录和版本变化。正式结果中禁止只写 `cindy-production`。每次实验必须把它解析成一个不可变 snapshot，例如：

```text
cindy-production-claude-2026-07-30-<profile-digest>
```

在开始正式比较前必须冻结以下事实：

1. 使用 Claude Code 还是 Codex；
2. 精确 model ID 和 provider route；
3. endpoint 是否为官方 API、公司 proxy 或其他兼容网关；
4. context limit 和 thinking/reasoning budget；
5. system prompt 的 commit/digest；
6. tool 和 MCP surface；
7. permission mode；
8. Maker Memory、native memory、project-context 是否关闭；
9. compaction 阈值；
10. 是否开启 subagent，以及 subagent model；
11. Agent binary 版本；
12. 容器镜像 digest、CPU、内存、网络和 deadline。

如果这些字段没有冻结，结果只能作为链路 smoke test，不能作为 harness benchmark 结果。

## 8. 公平性与归因设计

### 8.1 共同容器原则

正式 scored paired run 不能让 Cindy、Claude Code、Kimi Code 分别使用不同的 agent-specific task image。不同镜像会改变系统包、PATH、文件、缓存和可见工具，导致 container digest 不一致。

推荐做法是为每个 task 构建一个 immutable derived evaluation image：

- 先锁定该 task 原始 base image/Dockerfile digest；
- 在 base task image 上叠加同一个固定 Agent bundle layer；
- bundle 同时包含所有参与 arm 的固定版本 Agent binary 和 `cindy-headless`；
- 每个 arm 只启动自己的入口，其他 binary 虽然存在但不主动暴露进 prompt/tool 描述；
- 所有 paired arms 记录完全相同的 image digest、初始文件 snapshot 和资源策略；
- Agent setup 时间单独记录，不计入 task completion duration。

不同 task 可以有不同 derived image；要求相同的是“同一个 task 的所有 paired arms 使用同一个 derived image digest”。Agent binary 放在按名称隔离的目录中，运行时只将当前 arm 的目录加入 PATH，避免无关 CLI 意外参与命令解析。由于 binary 仍可能被主动发现，image manifest 必须公开记录完整 bundle 内容。

如果任务无法使用共同镜像，备选方案必须证明 child image 除 adapter payload 外字节等价，并在报告中标记为 fairness limitation。我们已经构建的 `cindy/harbor-claude-code:2.1.220` 只用于环境 smoke test，不能直接作为正式 paired benchmark 的唯一一侧镜像。

### 8.2 Pairing 约束

同一个 paired cell 必须一致：

- task ID、dataset revision、verifier 和初始文件 digest；
- model requested/effective ID、provider route、context limit 和 thinking budget；
- repetition ID 和预注册随机种子；
- CPU、内存、存储、网络 allowlist 和 agent deadline；
- 账号/限流等级及 throughput cap；
- 容器镜像 digest。

Agent 自带 prompt、工具定义和调度策略属于被测 harness，不应人工抹平，但必须记录 digest。各 arm 应交错或随机顺序执行，减少 provider 时间漂移和机器热状态影响。

### 8.3 计时边界

至少分别记录：

- environment build/start；
- agent setup；
- model/task execution；
- verifier；
- artifact collection。

Primary 的 finished-in-time 只使用预注册的 agent execution deadline。镜像拉取和首次安装不能混入模型完成时间，也不能因某个 arm setup 更慢而被误判为模型失败。

## 9. 首期测试范围

### 9.1 首期纳入

- 单个 Harbor task container；
- 一个冻结的 Cindy production snapshot；
- 一个精确模型 route；
- 一条初始任务指令；
- 容器内 Bash、文件读写、git 等基础能力；
- Cindy prompt、permission、tool、event、compaction 和 usage；
- Harbor verifier/reward；
- 1 次或预注册的多次 repetition。

### 9.2 首期默认关闭

- project-context：除非实验专门研究项目知识注入；
- Maker Memory：避免跨题持久化和宿主状态污染；
- IM/MCP 外部账号；
- Desktop browser、媒体、GUI 和设备能力；
- Scheduler、Orca、插件 UI；
- SSH remote host；
- 真实用户凭证持久化；
- 自动模型 fallback；
- 未记录的 prompt 或 tool 动态变更。

首期使用全新 trial HOME，不挂载宿主 `~/.claude`、`~/.codex`、Cindy userData 或历史 session。profile 关闭 project-context 时，即使 task 中意外出现 `.cindy/project-knowledge` 或旧版 `.xdmaker/project-knowledge` 也不得注入；profile 开启时必须记录知识目录 digest，避免不同 arm 获得不同隐藏上下文。

### 9.3 可补充的独立实验

后续每个能力都应作为明确 profile 变量，而不是静默加入 baseline：

- `cindy-memory-on`；
- `cindy-project-context-on`；
- 不同 tool profile；
- planning/permission mode；
- compaction 策略；
- subagent 开关和模型；
- Claude backend 与 Codex backend；
- 网络策略和可访问外部工具；
- 多步 task 的 resume 语义。

## 10. 测试计划

### Phase 0：运行链路验证

- smoke 阶段允许使用 agent-specific 预装镜像验证链路；
- scored pilot 前对每个 task base image 构建包含所有 arms 的共同 immutable derived image；
- Harbor 跑 `hello-world`；
- 验证 task container、instruction、Agent、trace、verifier 和 reward；
- 验证有效/无效 API key、timeout、网络错误和进程清理；
- 验证结果中无 secret。

### Phase 1：Cindy headless contract test

使用固定虚拟任务验证：

- 创建 Session；
- 执行 Bash；
- 创建和修改文件；
- 读取文件；
- 返回最终答案；
- tool error 能回到 Agent；
- permission mode 生效；
- abort 能杀掉子进程；
- usage 和 trace 字段完整。
- 对同一 production snapshot，Desktop resolver 与 Headless resolver 输出相同的 prompt/tool/proxy/compaction digest；
- 新增 `AgentDeps` 或 profile 字段时 parity matrix/contract test 必须失败，直到明确归类。

这些测试不用于声称模型能力，只验证 headless 与 `maker-core` 的契约。

### Phase 2：单题真实模型 smoke test

- 固定一个模型和一个 `hello-world` task；
- 运行 raw vendor、Cindy overlay 和至少一个外部 Agent；
- 记录相同 task/container/model/repetition；
- 检查 trajectory、usage、cost、reward 和退出原因；
- 失败时区分模型失败、认证失败、setup 失败和 verifier 失败。

### Phase 3：Terminal-Bench pilot

- 预注册 4–8 题；
- 覆盖 coding、system、data/file、security 等类别；
- 先运行 1 repetition；
- 链路稳定后再扩展到 3 repetitions；
- 运行前冻结 task IDs、dataset revision、container digest 和 manifest digest。

### Phase 4：完整矩阵

- Terminal-Bench 2.1 全量 89 题；
- 冻结的 Cindy production snapshot 与外部 Agent 的 same-model paired cells；
- 增加 Cindy 单变量 profile；
- 重要组合至少 3 次 repetition；
- 输出绝对分数、paired wins/losses、timeouts、infra-invalid、usage/cost。

## 11. 指标与结果解释

### Primary metrics

- Pass@1；
- 全量题目通过率；
- 预注册 hard-30 通过率；
- paired wins/losses/both-pass/both-fail。

### Secondary metrics

- finished-in-time pass rate；
- deadline-killed 数量；
- infra-invalid 数量和覆盖率；
- duration 和 time-to-completion；
- input/cache-read/output tokens；
- cost；
- 逐题失败类型；
- repetition 的置信区间。

单次 repetition 只能标记为 `descriptive, not statistical`，不能包装成稳定的能力结论。

### Attempt 状态分类

| 状态 | 是否进入主分母 | 是否允许补跑 | 示例 |
|---|---:|---:|---|
| `valid-completed` | 是 | 否 | Agent 正常结束，reward 由 verifier 决定 |
| `valid-deadline-killed` | 是 | 否 | 超过预注册 agent deadline |
| `valid-refusal` | 是 | 否 | 模型安全拒绝或明确不执行，通常 reward 0 |
| `infra-invalid-auth` | 否 | 按策略 | key 缺失、过期、endpoint/key 不匹配 |
| `infra-invalid-route` | 否 | 按策略 | requested/effective model 不一致 |
| `infra-invalid-environment` | 否 | 按策略 | 镜像损坏、容器启动失败、磁盘故障 |
| `infra-invalid-provider` | 否 | 按策略 | 预定义的临时 provider outage/rate limit |

原始 attempt 永远保留。补跑创建新的 attempt ID，并通过 `replaces_attempt_id` 关联，不能覆盖或人工选择最好结果。

## 12. 预期最终交付物

代码交付：

- `cindy-headless` CLI；
- 无 Electron headless host；
- Harbor `cindy-headless` Agent adapter；
- 固定 profile schema 和校验器；
- trace/usage/result writer；
- timeout、auth、network、infra 错误分类；
- 可复现的共同 benchmark image 构建定义、SBOM 和 image digest；
- 单元、契约和 smoke tests。

评测交付：

- secret-free benchmark manifest；
- immutable expanded plan；
- dataset revision、task IDs 和 container digest；
- 每次 attempt 的原始 trace/log/reward/usage/identity；
- normalized JSONL results；
- 可审计报告；
- 可复现命令；
- 版本清单、预算和停止条件。

最终报告的首屏至少呈现：

```text
Experiment identity
  dataset revision / manifest digest / image digest / model route

Absolute results
  variant | valid attempts | pass@1 | deadline-killed | infra-invalid | cost

Paired results
  left vs right | wins | losses | both-pass | both-fail | unmatched

Attribution
  raw vendor -> Cindy overlay delta
  Cindy full harness -> external harness delta
```

报告必须同时提供逐题明细和原始 artifact 链接。`unmatched` cell、infra-invalid 和补跑不能隐藏在总通过率中。

一次成功 trial 的最小产物应类似：

```text
results/<job-id>/<trial-id>/
  identity.json
  config.json
  trace.jsonl
  trajectory.json
  usage.json
  result.json
  verifier/reward.txt
  verifier/ctrf.json
```

## 13. 验收标准

- [ ] `cindy-headless` 不依赖 Electron、BrowserWindow、Desktop IPC 或本机 GUI。
- [ ] headless 使用 `maker-core` 的现有 Agent/session/event 抽象，不重写 Agent Loop。
- [ ] Cindy 与外部 Agent 在同一个 Harbor task container 契约下执行。
- [ ] 正式 paired arms 使用相同的 immutable image digest，或明确记录并批准例外。
- [ ] raw vendor 与 Cindy-over-vendor 消融 arm 可运行，Cindy 增量可归因。
- [ ] Desktop 与 Headless 的 production prompt/runtime snapshot 通过 digest parity gate。
- [ ] Agent binary、Cindy commit、profile、model route、tool surface 和 container image 都可追溯。
- [ ] 不支持的 agent/model 组合在执行前失败，不隐式换模型。
- [ ] timeout、infra-invalid、认证错误和普通 reward 失败不会混为一类。
- [ ] deadline-killed 和模型拒绝作为有效结果进入主分母，不被基础设施补跑洗掉。
- [ ] 每个 trial 使用干净 HOME，不读取宿主 Agent/Cindy 历史配置。
- [ ] 原始 attempt 不覆盖；允许补跑时有固定策略。
- [ ] trace、manifest、报告和 Harbor 配置不含 API key、token 或完整私有 prompt。
- [ ] `hello-world` 真实模型 smoke test 成功，包含非零 token、trajectory 和 reward。
- [ ] Phase 1 pilot 可按固定 manifest 重新运行。
- [ ] 全量付费运行前明确 cell 数量、token/cost 上限和停止条件。

## 14. 风险与待决策事项

### 高风险

- Desktop host 中的真实生产配置分散在多个 Electron adapter，headless host 可能遗漏 prompt、MCP 或 auth 行为；
- 为各 arm 构建不同预装镜像会污染 paired fairness；
- provider proxy 对模型字段、缓存和 thinking 参数的兼容性可能与 Desktop 不同；
- Agent CLI 的版本升级会改变默认模型、工具或输出格式；
- subagent 和后台任务会增加 token、trace 和结束语义的复杂度；
- Harbor/Windows 控制台输出可能出现编码问题；
- setup 阶段下载 Agent 会引入不可控的网络和时间噪声。

### 开始实现前必须确认

- production snapshot 的 owner、生成流程和冻结配置；
- 首期 backend 是 Claude 还是 Codex；
- 是否允许使用公司 proxy，及 proxy 的精确 route；
- system prompt 是否可以进入 headless profile；
- 首期 tool/MCP 白名单；
- Memory/project-context 是否明确关闭；
- headless 包放在 `apps/` 还是独立 benchmark workspace；
- Harbor adapter 是随 Cindy 仓库维护，还是单独 benchmark 仓库维护；
- 结果是否上传 Harbor Hub，还是只保存本地/CI artifact。

## 15. 当前状态

已验证：

- Harbor `0.20.0` 已安装在 `D:\Tools\Harbor`；
- Docker Linux 环境可用；
- `hello-world` 的 Oracle smoke test reward 为 `1.0`；
- 预装 Claude Code `2.1.220` 的 smoke-test 镜像已构建；该镜像不是 Cindy，也不用于正式 paired score；
- 通过 proxy 运行的真实 Claude Code `hello-world` trial 已成功，reward 为 `1.0`，产生真实 token、cost 和 trajectory。

尚未实现：

- `cindy-headless` CLI；
- 无 Electron Cindy host；
- Harbor `cindy-headless` adapter；
- Cindy 与外部 Agent 的 same-model benchmark plan；
- Terminal-Bench pilot 报告。

当前真实 Claude Code `hello-world` 的 reward `1.0` 只证明 Harbor、预装 CLI、proxy、模型调用、trajectory 和 verifier 链路可用；它没有经过 Cindy overlay，因此不是 Cindy Headless 成绩。Cindy Headless 的验收不预设“必须高于某个 Agent”，首要标准是 parity、可复现、可归因和无隐式换模。

## 16. Issue #127 补充的冻结契约

以下条目由 Issue #127 直接要求，属于 Phase 0/正式计分前的硬门槛，而不是可选优化。

### 16.1 Adapter capabilities schema

每个 adapter 必须发布机器可读 capabilities JSON，至少包含 `adapterId`、`adapterVersion`、`agentBackend`、`supportedModelIds`、`supportedPermissionModes` 和 artifact contract。`supportedModelIds` 必须是精确 ID 的非空数组，不接受 `*`、`latest` 或未解析 alias。Planner 在生成 cell 前计算 adapter、profile 与 model route 的交集；交集为空时标记 `unsupported` 并停止，执行期不得 fallback。

### 16.2 Profile 继承和单变量归因

实验 profile 增加 `parentProfile` 与 `changedDimensions`。除 production snapshot 外，配置变体必须声明父 profile，且 `changedDimensions` 与实际 diff 一致。主报告拒绝把同时改变 prompt、tools、memory 等多个维度的结果解释为单一因素提升。

### 16.3 Phase 0 Oracle gate

在运行任何 Agent 前，先用固定 Terminal-Bench 2.1 revision 对排序后的前五个 task ID 运行 Oracle。manifest 保存五个 ID、排序规则、dataset revision、task container/verifier digest 和 reward。任一 Oracle 不通过，该批次整体为 infrastructure invalid，不得继续生成 Agent 分数。

### 16.4 两张榜单严格分离

输出必须分成两张独立榜单：

1. same-model harness board：所有 paired cells 使用同一精确模型和 route，用于 harness 归因；
2. default-model product board：各产品使用推荐模型，只描述整体产品体验。

两张榜单使用不同 manifest、结果目录和报告标题，禁止合并排序或用产品榜结果解释 harness 差异。

### 16.5 Throughput cap

如果实验声称约束输出速率，必须提供可执行的限速位置、算法、目标值、容差和观测证据。只在 manifest 写 `35 tok/s` 不算已实施。报告同时保存 provider 原始时间戳、观察到的 output tokens/s、被限速等待时长和是否达到容差；无法可靠实施时标记 fairness limitation，不得声称同速率。

### 16.6 Hard-30 冻结

hard-30 的来源、公开 historical solve-rate 数据 revision、筛选脚本版本、排序和并列规则、精确 30 个 task ID 必须在主实验前生成并写入 immutable manifest。保存 task list digest；本轮结果产生后不得修改。缺少外部历史数据时可以不发布 hard-30，但不能用本轮结果反向挑题。

## 17. 仓库布局决定

正式实现放在 Cindy monorepo：`apps/cindy-headless` 直接复用 `@cindy/maker-core`，`benchmarks/harbor` 保存 adapter/profile/计划契约，本文档保存在 `docs`。开发时可以在 `D:\Work` 使用独立 clone/worktree 隔离分支，但不维护第二套独立产品仓库。这样 Desktop 与 Headless 才能共享 Agent loop、版本 pin 和类型检查，并建立 prompt/runtime digest parity gate。
