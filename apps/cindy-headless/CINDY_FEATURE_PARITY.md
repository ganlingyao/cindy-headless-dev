# Cindy to Headless feature parity

This inventory applies to Cindy Headless `0.3.2`, based on Cindy upstream commit
`b91b78c507a6605bb631ad6e85bf82d94d71efd2`. A feature is considered available
only when the Headless CLI or Harbor adapter can exercise it; vendored source
alone is not sufficient.

## Available in Headless

| Cindy capability | Claude Code | Codex | Pi | Headless evidence |
|---|---:|---:|---:|---|
| Multi-turn Maker session | Yes | Yes | Yes | `run --turns-file`, structured terminal events |
| Cindy production system prompt | Yes | Yes | Yes | Prompt parity tests against Desktop sources |
| Project context injection | Yes | Yes | Yes | Profile-controlled TOC injection |
| Cindy Maker Memory | Yes | Yes | Yes | In-process MCP for Claude; authenticated loopback MCP bridge for Codex and Pi |
| Model identity pinning | Yes | Yes | Yes | Frozen profile and identity artifacts |
| Explicit context-window pinning | Yes | Yes | Yes | Profile model metadata is passed to each harness context resolver |
| Explicit effort pinning | Yes | Yes | Yes | Production and generated profiles pin `high`; Pi rejects unsupported `ultra` |
| Abort, deadline, and bounded cleanup | Yes | Yes | Yes | Signal/deadline handling and result classification |
| Structured text, thinking, tool, status, and terminal events | Yes | Yes | Yes | Raw and normalized trace artifacts |
| Token, cache, context, and cost evidence | Yes | Yes | Yes | Backend-specific usage normalization |
| Container-sandboxed unattended execution | Yes | Yes | Yes | Formal profiles require `containerSandbox=true` |
| Pinned runtime supply chain | Yes | Yes | Yes | SHA-256 download pins and bundle validation; Pi validates its complete runtime tree |
| Workspace file/image attachments | Yes | Yes | Yes | Structured `--turns-file`; canonical workspace containment and size/count limits |
| Frozen remote HTTP MCP | Yes | Yes | Yes | Profile-pinned HTTPS/loopback endpoints; secret values supplied only through named environment variables |
| BYOM/native provider routing | No | No | Yes | Pi `models.json` native-provider route; exact provider/model/API metadata in the profile and artifacts |
| Approved project Skills | No | No | Yes | Profile allowlisted roots, Git-root/canonical-path checks, immutable per-session Pi snapshot, revision and paths in artifacts |

Pi is connected through its native RPC and `models.json` compatibility layer.
Headless does not translate Pi traffic through Claude Code. The bundled Pi
version is `0.84.4`; its complete runtime directory is required because the
standalone executable depends on sibling themes and native assets.

## Present in Maker Core but not exposed by the Headless CLI

These capabilities are available to Cindy Desktop through the same current
`maker-core`, but need a stable Headless command/artifact contract before they
can be claimed for benchmark runs:

- model and permission changes during a running task;
- fork, rewind, Pi session-tree navigation, and HTML export;
- manual compact and runtime extension/command discovery;
- managed Pi packages and runtime extensions;
- vision-bridge routing;
- Orca worker creation and subagent control APIs.

The `a28f9762..b91b78c5` audit identified two runtime candidates that still need
a separate Headless contract before parity can be claimed: Cindy-provider
Codex remote compaction/encrypted-context recovery, and the dynamic Pi gateway
model-catalog metadata surface (`thinkingLevelMap`, compatibility flags, and
sampling parameters). Codex native compaction remains available, but Headless
does not falsely advertise the Cindy proxy as active, so the Cindy-provider
recovery path is not configured. The current Pi gateway baseline is an explicit
Anthropic-Messages-compatible route; Pi BYOM uses exact API metadata from its
profile.

They remain fail-closed. Headless does not silently read a user's Desktop
configuration, Pi home, plugins, extensions, credentials, or approval state.

## Host-specific and intentionally excluded

The following require an Electron, mobile, account, device, or interactive UI
host and are not Headless runtime features:

- windows, renderer panels, tray, menus, notifications, voice input, and OS
  permission guides;
- login/account lifecycle, updater UI, analytics, and desktop settings stores;
- mobile UI, device-link control, IM presentation, and conversation sharing;
- plugin panels, OAuth/setup dialogs, media galleries, and user confirmation UI;
- browser/computer/phone UI control and local app integrations;
- SSH workspace management and Desktop-owned remote daemon lifecycle.

Headless Pi therefore supports only container-sandboxed
`bypassPermissions`. `ask` and `auto` are rejected because Harbor has no
interactive approval channel; accepting them would either hang or weaken the
Pi permission contract.

## Frozen production profiles

`cindy-production-pi` is the canonical Pi production baseline. It pins Pi
`0.84.4`, the production prompt digest, attachment policy, project Skill roots,
and an empty custom-MCP set. BYOM and custom MCP are supported profile fields,
but remain empty in this baseline so endpoint/tool changes cannot silently alter
scores. Create a separately named derived profile and freeze its profile digest
when evaluating either dimension.

`cindy-production-claude` is the Claude Code production baseline and is the
canonical meaning of “cindy-production-cc”. A second `cindy-production-cc`
profile is intentionally not created because two names for the same executable,
prompt, and policy would create ambiguous benchmark identity.

## Update rule

For each Cindy update, inspect `maker-core`, prompt sources, runtime pins,
Agent translators, usage events, and MCP contracts. Update this inventory and
add a contract test whenever a capability moves between categories. Historical
benchmark results remain immutable.
