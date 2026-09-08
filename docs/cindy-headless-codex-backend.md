# Cindy Headless Codex Backend

`cindy-headless` now supports Cindy's native `CodexAgent` in addition to the
existing Claude Code backend. The implementation stays inside Cindy's existing
Maker Core and does not reimplement the Codex agent loop.

## Runtime

- Profile value: `agentBackend: "codex"`.
- Transport: Cindy's `CodexAgent` and app-server stdio transport.
- Authentication: an explicit `CINDY_HEADLESS_CODEX_HOME` (or `CODEX_HOME`)
  is passed to the child process. Headless does not copy, persist, or silently
  discover a user's local Codex home.
- Native tool surface: Codex app-server capabilities, including plan mode,
  multi-turn sessions, approvals, resume, and native usage events already
  implemented in `packages/maker-core`.
- Usage: `done.data.usage.promptTokens`, `cachedTokens`, and
  `completionTokens` are normalized into the fixed `usage.json` schema while
  preserving the raw provider record.

## Maker Memory

When `makerMemory` is enabled, Headless supplies Cindy's existing
`cindy_memory` provider to Codex through a small Streamable HTTP bridge:

- binds only to `127.0.0.1`;
- uses a random bearer token generated for each run;
- creates isolated MCP sessions per Codex connection;
- rejects non-loopback and unauthenticated requests;
- closes all transports when Maker shuts down.

The bridge is in `apps/cindy-headless/src/codex-memory-bridge.ts`. It does not
import Desktop MCP registries, Electron IPC, browser UI, computer use, IM, Orca,
or scheduler services.

## Profiles and Verification

The production example is
`apps/cindy-headless/profiles/cindy-production-codex/profile.example.json`.
The local smoke profile is intentionally separate because a developer Codex
home can contain unrelated MCP configuration.

Verified locally on Windows with Codex CLI `0.145.0`:

- `doctor` passed using the explicit local Codex home;
- a real `gpt-5.4-mini` Cindy Headless turn completed;
- the model called `cindy_memory:list_tools` and `cindy_memory:call_tool`;
- `usage.json` contained non-zero prompt, cache, and output counts;
- bridge authentication and MCP initialize behavior passed an automated test.

For Harbor, mount an isolated Codex home containing only the credentials and
configuration needed by the task. Do not mount a developer's full `~/.codex`,
because its unrelated MCP servers and plugins are outside Cindy Headless's
declared harness surface.

## Harbor Task-Container Verification

A real Harbor 0.20 `hello-world` trial completed on 2026-08-03 using the
`cindy-production-codex` profile and the pinned Linux Codex `0.145.0` binary.

- Job: `cindy-headless-codex-hello-world-v3`
- Trial: `hello-world__C9DHELj`
- Model: `gpt-5.4-mini`
- Reward: `1.0`
- Exceptions and retries: `0`
- Headless status: `valid-completed`
- Agent execution: `17.431s`
- Harbor total runtime: `1m 23s`
- Input/cache/output tokens: `36771 / 28288 / 422`
- Verifier tests: `2 passed, 0 failed`
- Credential-pattern matches in collected artifacts: `0`

The trial created `/app/hello.txt`, read it back through the Codex native tool
surface, and the Harbor verifier confirmed both file existence and exact
content. The Codex home uploaded by the adapter contained only `auth.json`; no
developer MCP or plugin configuration entered the container.
