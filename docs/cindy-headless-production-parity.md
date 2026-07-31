# Cindy Headless Production Parity

This document defines which Cindy Desktop harness behavior is reproduced by
`cindy-headless`. It deliberately separates agent-visible behavior from
Electron-only product services.

| Cindy production capability | Desktop source of truth | Headless status |
| --- | --- | --- |
| Maker Core session lifecycle | `packages/maker-core/src/maker.ts`, `session.ts` | Implemented |
| Claude Code Agent | `packages/maker-core/src/agents/claude-code` | Implemented |
| Production system prompt | `apps/desktop/src/main/maker-host/host-system-prompt.md`, `claude-system-prompt.md` | Implemented and digest-checked |
| Native Agent memory | `AgentRuntimeConfig.memoryEnabled` | Profile-controlled |
| Maker Memory manager | `MakerMemoryManager` and `cindy_memory` MCP | Profile-controlled, using Cindy's existing implementation |
| Project context | `.cindy/project-knowledge/TOC.md` injection before session start | Profile-controlled, same wrapper and source path |
| Permission mode | `CreateSessionOptions.permissionMode` | Profile-controlled |
| Compaction | `AgentRuntimeConfig.autoCompactThresholdPct` | Profile-controlled |
| Claude native tools | Claude Code SDK/CLI | Inherited from pinned Claude Code |
| `cindy_memory` MCP | `packages/lizi-mcps/src/cindy_memoryMcpServer.ts` | Implemented through the narrow `@cindy/mcps/memory` entry |
| Desktop MCP services (IM, browser UI, computer UI, Orca, scheduler) | `apps/desktop/src/main/mcp-integrations` | Not injected unless a real container-safe host adapter exists |
| Electron UI, local DB, account stores | `apps/desktop/src/main` | Not applicable to Harbor task execution |

## Memory Rules

`makerMemory` and `nativeMemory` are mutually exclusive, matching
`AgentRuntimeConfig` semantics in Maker Core. A production run can persist
Maker Memory across sessions by setting `CINDY_HEADLESS_STATE_DIR` to a stable
directory. Without that variable, state is scoped to the run output directory.

When `projectContext` is enabled, Headless reads only:

```text
.cindy/project-knowledge/TOC.md
```

Missing or empty project knowledge is non-fatal and is recorded in
`config.json` and `identity.json`.

## Harbor Boundary

Harbor supplies the task container, working directory, verifier and resource
limits. It does not replace Cindy's Agent loop. The adapter must mount or copy
the selected profile, pinned bundle and any explicit state directory, then
record their digests in the result artifacts.
