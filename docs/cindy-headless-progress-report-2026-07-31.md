# Cindy Headless 开发与测试进展汇报

日期：2026-07-31  
Issue：[#127 建立 Cindy Agent Benchmark](https://github.com/makecindy/cindy/issues/127)  
开发目录：`D:\Work\cindy-headless-issue-127`  
开发分支：`feat/cindy-headless-127`  
状态：本地已完成开发和真实 smoke 验证，尚未提交、推送或创建 PR。

## 1. 工作结论

本次已完成一个可以在 Harbor task container 中真实运行的 `cindy-headless` Phase 0 实现。

最重要的真实验证结果如下：

- Cindy Headless 在 Harbor Docker task container 内成功启动；
- 通过 `@cindy/maker-core` 创建 Cindy Agent Session；
- 使用 Claude Code 2.1.219 访问配置的 LLM proxy；
- 使用精确模型 ID `claude-sonnet-4-6` 完成 `hello-world` 任务；
- Harbor verifier reward 为 `1.0`；
- Harbor trial 无 exception；
- 真实任务产生了 token 和费用；
- 结果及 trace 中没有发现 API key 或 token 泄露。

这证明的是“Cindy Headless 的运行链路可用”，不是 Terminal-Bench 全量成绩，也不能据此宣称 Cindy harness 比其他 Agent 更强。

## 2. 本次实现内容

### 2.1 Headless CLI

目录：`apps/cindy-headless`

当前 CLI 命令：

```text
cindy-headless version
cindy-headless doctor --profile <profile.json>
cindy-headless profile validate --profile <profile.json>
cindy-headless capabilities --profile <profile.json>
cindy-headless run --profile <profile.json> --task <instruction>
cindy-headless plan --manifest <manifest.json> --output <plan.json>
cindy-headless oracle-gate --manifest <manifest.json> --results <results.json>
```

实现特征：

- 不依赖 Electron、BrowserWindow 或 Desktop IPC；
- 复用 Cindy 现有 `@cindy/maker-core` Agent、Maker、Session 和事件模型；
- Phase 0 后端为 Claude Code；
- Codex 后端暂未实现；
- 支持指定工作目录、输出目录和 deadline；
- 输出 JSON 结果，便于 Harbor 和后续报告器消费。

### 2.2 Profile 与能力校验

Profile 用于冻结一次实验的运行事实，包含：

- agent backend；
- Claude binary 路径和版本；
- 精确模型 ID、provider、route ID；
- permission mode；
- production system prompt 文件及 digest；
- compaction 配置；
- project-context、Maker Memory、native memory 状态；
- 是否运行在 container sandbox；
- supported model ID 列表。

校验规则包括：

- `supportedModelIds` 必须是精确、非空且无重复的模型 ID；
- 禁止 `latest`、`*` 等漂移 alias；
- profile 请求模型必须出现在支持列表中；
- 不允许隐式 fallback 或静默换模；
- 派生 profile 必须填写 `parentProfile` 和 `changedDimensions`；
- Phase 0 默认关闭 project-context、Maker Memory 和 native memory；
- system prompt digest 不匹配时在真正调用模型前失败。

### 2.3 Desktop/Headless prompt parity

Headless 使用 Desktop 当前 production prompt 的组合结果：

```text
host-system-prompt.md
claude-system-prompt.md
```

已增加 parity 测试，确保 Headless 与 Desktop prompt 内容一致，并处理 Windows CRLF 与 Linux LF 的跨平台换行差异。当前 production prompt digest 为：

```text
64bf986a1329a9b1a7bdb15e5a13da4ea75d16736a9f4acda365e9019def6272
```

公开结果只记录 digest，不记录完整敏感 prompt 内容。

### 2.4 API URL 与 API key

支持以下环境变量：

- URL：`CINDY_HEADLESS_BASE_URL` 或 `ANTHROPIC_BASE_URL`；
- key：`CINDY_HEADLESS_API_KEY` 或 `ANTHROPIC_API_KEY`。

凭证不写入：

- profile JSON；
- Harbor manifest；
- trace；
- result；
- Git 仓库。

Harbor 配置只使用环境变量占位符，例如 `${ANTHROPIC_API_KEY}`。

### 2.5 干净运行环境

每次 Headless trial 会创建临时 HOME，并设置独立 `CLAUDE_CONFIG_DIR`，避免读取：

- 操作系统用户的 `~/.claude`；
- `~/.codex`；
- Cindy Desktop userData；
- 历史 session；
- `.cindy/project-knowledge` 或 `.xdmaker/project-knowledge`。

这保证 benchmark 不会因为本机历史记忆或项目上下文而污染结果。

### 2.6 产物与错误分类

每次 trial 输出：

```text
identity.json
config.json
trace.jsonl
stderr.log
usage.json
result.json
```

错误状态至少区分：

- `valid-completed`：Agent 正常结束，由 verifier 判定任务结果；
- `valid-deadline-killed`：超过预注册 deadline；
- `valid-agent-error`：Agent 执行期间发生可归因于 Agent 的错误；
- `infra-invalid-auth`：认证缺失、过期或 401；
- `infra-invalid-route`：请求模型与实际 route/model 不一致；
- `infra-invalid-provider`：网络、rate limit、provider 暂时性故障；
- `infra-invalid-environment`：容器、binary、权限或文件系统问题。

原始 trace 不覆盖，补跑必须使用新的 attempt ID。

### 2.7 Harbor adapter

目录：`benchmarks/harbor`

使用 Harbor 0.20 的标准自定义 Agent 机制：

```text
agent.import_path: cindy_headless_agent:CindyHeadlessAgent
```

Adapter 的职责：

1. 将预构建 Headless bundle 上传到 `/opt/cindy-headless`；
2. 上传完整 profile 目录，保证相对 prompt 文件可解析；
3. 设置 Claude binary 执行权限；
4. 运行 `cindy-headless doctor`；
5. 将 Harbor task instruction 传递给 Headless；
6. 同步 trace、usage、result 等 artifact；
7. 将归一化 usage 回填到 Harbor `AgentContext`。

不会在 scored trial 中执行 `pnpm install`、下载浮动版本 Claude 或 checkout Cindy `main`。

### 2.8 Benchmark 控制面

已实现最小 benchmark 控制面：

- manifest 校验；
- `variant × model × task × repetition` 计划展开；
- same-model board 的模型支持交集校验；
- 前五题 Oracle gate 校验；
- `parentProfile / changedDimensions` 归因元数据。

这部分只生成计划和验证结果，不自动扩大到 Terminal-Bench 全量付费运行。

## 3. 实际测试内容与结果

### 3.1 静态与单元测试

执行命令：

```powershell
pnpm --filter cindy-headless typecheck
pnpm --filter cindy-headless test
```

结果：

- TypeScript typecheck：通过；
- Vitest：通过；
- 测试文件：4 个；
- 测试用例：11 个；
- 失败：0。

覆盖内容：

- profile 精确模型校验；
- alias/fallback 拒绝；
- 派生 profile 元数据校验；
- prompt digest 校验；
- Desktop/Headless prompt parity；
- benchmark plan 展开；
- unsupported model 拒绝；
- Oracle gate；
- success/deadline/auth 错误分类；
- provider usage 归一化。

### 3.2 Doctor 测试

Doctor 验证了：

- API key 环境变量存在；
- endpoint 已配置；
- Claude binary 存在；
- Claude binary 版本为 `2.1.219`；
- production prompt digest 正确；
- 输出目录可创建。

### 3.3 本地真实 Headless smoke

任务：

```text
创建 result.txt，内容必须为：Cindy headless smoke passed；
然后读取并验证文件内容，不修改其他文件。
```

结果：

- 文件成功创建；
- 文件内容精确匹配；
- 模型真实完成工具调用；
- 产生真实 token/cost；
- 使用模型：`claude-sonnet-4-6`；
- 费用约 `$0.1510929`；
- context tokens：33513；
- 事件数：41。

本地结果目录：

```text
D:\Work\cindy-headless-issue-127\tmp\headless-real-result-2
```

### 3.4 Harbor 真实 smoke

任务：Harbor `hello-world`。

Job：

```text
D:\Tools\Harbor\jobs\cindy-headless-hello-world\cindy-headless-hello-world-v3
```

结果：

| 指标 | 结果 |
|---|---:|
| Harbor reward | 1.0 |
| Trials | 1 |
| Exceptions | 0 |
| Agent status | valid-completed |
| Model | claude-sonnet-4-6 |
| Claude Code | 2.1.219 |
| Cindy profile | cindy-production-claude |
| Headless duration | 7013 ms |
| Harbor total runtime | 约 61 秒 |
| Cost | 约 `$0.13154235` |
| Context window | 1,000,000 |
| Events | 28 |
| Secret matches | 0 |

结构化 Harbor job 统计显示：

```text
cindy-headless__claude-sonnet-4-6__adhoc
trials: 1
errors: 0
mean reward: 1.0
```

### 3.5 失败路径测试

开发过程中还验证并修复了以下失败：

1. 使用不存在的 `claude-sonnet-4-5` 时，proxy 返回 400，正确暴露模型 route 错误；
2. Harbor root 容器未设置 sandbox 时，Claude 拒绝 `--dangerously-skip-permissions`；
3. 修复为 profile 显式 `containerSandbox: true`，只在容器 profile 中注入 `IS_SANDBOX=1`；
4. Harbor job 配置修改后复用旧 job 名会被 Harbor 拒绝，改用新 job 名保留原始 attempt；
5. Windows GBK 输出导致 Harbor 汇总展示异常，但不影响 trial 结果；
6. 通过 stderr artifact 将 `sdk_stream_crashed` 进一步定位为 root 权限安全限制。

## 4. 已知问题与未完成内容

### 4.1 Usage 回填还需要再次验证

最新成功 Harbor trial 的 `identity/result/trace` 和 cost 已正确，但该 trial 使用的是 usage 归一化修复前构建的 bundle，所以 Harbor 顶层 `n_input_tokens/n_cache_tokens/n_output_tokens` 仍显示为空，`usage.json` 仍主要是 session snapshot。

代码已经增加从 `done` 事件提取 raw provider usage 的逻辑，但需要再次运行一次真实 smoke，确认新的 bundle 将 input/cache/output 正确回填到 Harbor 统计。

### 4.2 仍是单题 smoke，不是 benchmark 成绩

目前只验证了：

- 本地单题文件任务；
- Harbor 官方 hello-world 单题。

尚未完成：

- Terminal-Bench 2.1 前五题 Oracle 正式 gate；
- 4 至 8 题 Phase 1 pilot；
- hard-30 冻结和运行；
- 全量 89 题；
- 多 repetition 置信区间；
- paired raw Claude Code 对照组；
- Kimi/Codex/Gemini 等外部 adapter。

### 4.3 Linux bundle 目前是本地生成产物

Linux Claude binary 已按仓库记录的 SHA-256 校验，并生成 bundle manifest，但还没有：

- CI 自动构建；
- Docker derived image；
- image digest 锁定；
- SBOM 上传和长期 artifact 保管。

正式 benchmark 前必须将 bundle 纳入可复现构建流程，不能依赖开发机上的路径。

### 4.4 Production runtime parity 仍需扩展

目前已验证 prompt parity，但以下 Desktop runtime 维度还没有完整 parity gate：

- tool surface digest；
- MCP server surface；
- proxy/route resolver；
- subagent model defaults；
- compaction store 的完整配置；
- native memory 与 project-context 的显式关闭证据。

当前 profile 已明确关闭 memory/project-context，但这是 Phase 0 的固定策略，不代表 Desktop 与 Headless 的所有 runtime 细节已完全共享。

### 4.5 Codex 暂未支持

Issue #127 目标包含 Codex CLI 等外部 Agent，但当前 Cindy Headless 只实现 Claude Code backend。Codex 需要单独实现并验证：

- app-server transport；
- auth mode；
- model capability intersection；
- resume/history；
- event/usage normalization；
- Harbor adapter。

### 4.6 throughput cap 尚未真正实施

Profile 可以声明 throughput cap 的结构，但当前没有在 Headless 内实现可靠 token/s 限速器，也没有输出 provider timestamp、等待时长和容差证据。因此目前不能声称实现了“约 35 output tok/s 公平限速”。

### 4.7 Windows Harbor 展示存在编码问题

Harbor trial 本身成功，但部分 Windows 控制台使用 GBK 时无法打印 Rich 的 Unicode 项目符号。建议后续统一：

- `PYTHONUTF8=1`；
- `PYTHONIOENCODING=utf-8`；
- 或使用 UTF-8 terminal/CI runner。

## 5. 汇报时应如何表述

建议对外表述为：

> 已完成 Cindy Headless Phase 0 的可运行实现。该实现无 Electron 依赖，复用 Cindy `maker-core`，通过 Harbor 自定义 Agent adapter 在 task container 内运行，并支持固定 profile、精确模型校验、干净 HOME、trace/usage/result artifact 和错误分类。已使用真实 API URL/key 完成本地和 Harbor hello-world smoke，Harbor reward 1.0、无异常。当前结果仅证明运行链路和单题可用，不代表 Terminal-Bench 全量性能，也不代表 Cindy 相比其他 harness 的统计优势。

不要表述为：

- “Cindy 已完成 Terminal-Bench benchmark”；
- “Cindy 比 Claude Code 更强”；
- “已完成 89 题或 hard-30”；
- “已实现 35 tok/s 限速”；
- “Headless 与 Desktop 所有 runtime 已完全一致”；
- “Codex adapter 已完成”。

## 6. 后续建议

### P0：让结果统计完整

1. 使用 usage 归一化修复后的 bundle 再跑一次 Harbor hello-world；
2. 确认 Harbor 顶层 input/cache/output tokens 非空；
3. 将 usage schema 固定并加入回归测试。

### P1：完成 Phase 0 Oracle gate

1. 固定 Terminal-Bench 2.1 revision；
2. 冻结排序后的前五题 ID；
3. 先运行 Oracle；
4. Oracle 全部 reward 1.0 后才允许 Agent pilot。

### P1：完成 Phase 1 pilot

1. 预注册 4 至 8 题；
2. 固定一个精确模型 route；
3. 运行 Cindy production profile；
4. 运行 raw Claude Code 对照组；
5. 输出逐题结果、artifact 链接、cost 和失败分类。

### P2：扩展公平性和归因

1. 构建同一 task 的 derived immutable image；
2. 加入 tool/MCP/runtime digest parity；
3. 实现 throughput cap 或明确标注 fairness limitation；
4. 加入外部 Agent adapters；
5. 最后才运行 89 题和 hard-30。

## 7. 代码与证据位置

实现：

```text
D:\Work\cindy-headless-issue-127\apps\cindy-headless
D:\Work\cindy-headless-issue-127\benchmarks\harbor
```

设计文档：

```text
D:\Work\cindy-headless-issue-127\docs\cindy-headless-benchmark.md
```

本汇报文档：

```text
D:\Work\cindy-headless-issue-127\docs\cindy-headless-progress-report-2026-07-31.md
```

Harbor 成功 trial：

```text
D:\Tools\Harbor\jobs\cindy-headless-hello-world\cindy-headless-hello-world-v3\hello-world__nXgsajK
```

本地真实 smoke 结果：

```text
D:\Work\cindy-headless-issue-127\tmp\headless-real-result-2
```

## 8. 当前工作区注意事项

- 当前工作区有未提交改动；
- 没有执行 commit、push 或 PR；
- `tmp/` 只包含本地 smoke 产物，不应提交；
- `dist/` 和 Linux bundle 是构建产物，是否纳入正式发布需要另行决定；
- API key 没有写入仓库；
- Harbor job 目录包含真实运行的元数据和 cost，应按内部实验数据管理；
- 重新运行必须使用新的 job name/attempt ID，不要覆盖已完成 trial；
- 同一模型 benchmark 必须固定 provider、route、model、task、container 和 repetition。
