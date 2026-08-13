# Cindy Headless

Cindy Headless is Cindy's container-friendly runtime. It reuses Cindy's `maker-core` and MCP contracts, then exposes the Claude Code and Codex harnesses through a CLI and a Harbor `BaseAgent` adapter. It does not recreate Cindy Desktop, Electron UI, or the Agent binaries.

## Quick start

Authorized internal users can download published packages from the private [Cindy Headless Releases](https://github.com/ganlingyao/cindy-headless-releases/releases). The dedicated release repository contains runtime and access-controlled full packages. Verify the selected archive with the attached `SHA256SUMS` before extraction, and confirm its `release-manifest.json.sourceCommit` matches the reviewed source revision.

From a source checkout on Windows:

```powershell
Copy-Item apps/cindy-headless/config.example.json apps/cindy-headless/config.local.json
# Set the gateway URL/key in the ignored config.local.json.
./apps/cindy-headless/scripts/setup.ps1
cd ..\..\AgentTest\harbor
uv run harbor eval execute <freeze-id> --workspace-root . --approve
```

From the runtime GitHub Release asset, extract `cindy-headless-linux-x64-runtime-<version>.tar.gz`, configure the gateway, and run `prepare-binaries.ps1` or `prepare-binaries.sh`. The public archive is the Cindy Headless runtime, not a Claude Code or Codex redistribution. The preparation script downloads the exact pinned Agent runtimes from their official sources and verifies SHA-256 before use.

## Layout

```text
apps/cindy-headless/src/       Runtime, profiles, benchmark and artifact code
apps/cindy-headless/profiles/  Pinned backend/model/profile definitions
apps/cindy-headless/scripts/   Bundle and compatibility verification scripts
apps/cindy-headless/bundle/    Reproducible Linux x64 bundle output
apps/cindy-headless/harbor-compatibility.json  Harbor adapter contract and pinned features
```

## Prerequisites

- Node.js 22 and the repository dependencies installed with pnpm.
- A pinned Linux x64 Claude Code and Codex binary for bundle creation.
- Harbor 0.20 for container tests.
- Either a temporary isolated Codex home or the unified gateway configuration.

Never put an API key in a profile, manifest, bundle, Git-tracked file or result artifact. Use environment variables or the ignored `apps/cindy-headless/config.local.json`.

## Local configuration

```powershell
Copy-Item apps/cindy-headless/config.example.json apps/cindy-headless/config.local.json
# Edit config.local.json locally, or set CINDY_HEADLESS_BASE_URL and CINDY_HEADLESS_API_KEY.
```

The config file is ignored. It supports an Anthropic-compatible gateway for Claude and an OpenAI Responses-compatible `/v1` route for Codex. Offline commands such as `version`, `plan` and `report` do not load gateway credentials.

## Build and verify

Run the normal checks:

```powershell
npm --prefix apps/cindy-headless run typecheck
npm --prefix apps/cindy-headless test -- --run
npm --prefix apps/cindy-headless run build
```

Build the scored Linux bundle with pinned binaries:

```powershell
$env:CINDY_CLAUDE_BINARY = 'D:\path\to\pinned\claude'
$env:CINDY_CODEX_BINARY = 'D:\path\to\pinned\codex'
npm --prefix apps/cindy-headless run bundle:linux
npm --prefix apps/cindy-headless run verify:bundle
```

The bundle is registered against one Benchmark Tool backend. The default is
`claude-code`; set `CINDY_HEADLESS_AGENT_BACKEND=codex` before `bundle:linux`
when producing a Codex bundle. `bundle-manifest.json.agentBackend` must match
the selected profile. Rebuild and publish a new immutable release when changing
the backend; do not reuse a multi-backend manifest or relax Benchmark Tool
validation.

`bundle-manifest.json` records the Cindy commit, prompt digests, binary digests, observed versions and Headless contract version. Rebuild it whenever runtime source or pinned binaries change.

## Release packages

Generate the public runtime package:

```powershell
npm --prefix apps/cindy-headless run package:runtime
```

The output under `apps/cindy-headless/release` includes the runtime archive, `bundle-manifest.json`, `release-manifest.json` and `SHA256SUMS`. It does not contain vendor Agent binaries; users obtain the pinned runtimes with the included `prepare-binaries` script. Publish release assets in the dedicated private `ganlingyao/cindy-headless-releases` repository, not in the Cindy source repository.

`package:full` exists behind an explicit vendor-binary flag for controlled/internal distribution. Do not upload a full package publicly until the applicable Claude Code and Codex redistribution terms have been reviewed and the required notices are included. A GitHub Release should be titled `Cindy Headless <version>`; Claude Code and Codex are backends, not the product name.

### Internal full package

For an access-controlled internal test environment, first build and verify the pinned Linux bundle, then generate and validate the full package:

```powershell
npm --prefix apps/cindy-headless run package:full
npm --prefix apps/cindy-headless run verify:distribution:full
```

The output directory contains both the normal runtime archive and `cindy-headless-linux-x64-full-<version>.tar.gz`. The full archive includes the verified Linux x64 Claude Code and Codex binaries under `bin/`, so its recipient can extract and run it in Linux, WSL or the Harbor Linux task container without the initial binary download. It is not a native Windows Agent package. `SHA256SUMS`, `bundle-manifest.json` and `release-manifest.json` must travel with the archive and be checked before use.

The runtime package does not contain a Harbor adapter. Formal Benchmark runs
use the pinned Harbor fork and its single built-in adapter:
`harbor.agents.installed.cindy_headless:CindyHeadlessAgent`. Run Harbor from
its own checkout and pass `--workspace-root` there. Keep `bundle_dir` and
`profile_path` relative to that root; never copy an adapter into this repo or
put a maintainer's local path in a job file. The required adapter contract is
recorded in `harbor-compatibility.json`.

Treat this as an internal artifact, not a public GitHub Release asset. Store it only in an access-controlled artifact system, retain `VENDOR-BINARIES-NOTICE.txt`, and review the applicable vendor redistribution terms before sharing it outside the organization. The included `prepare-binaries` scripts remain available for repairing or refreshing the pinned binaries, but are not required for the first run of a verified full package.

Before publishing, run `scripts/verify-clean-install.ps1` from a pushed branch. It clones into a temporary directory and verifies that the documented source workflow does not depend on the maintainer's working tree. Run the Harbor smoke separately from the Harbor checkout when gateway credentials and Docker are available.

## CLI

Validate a profile and inspect compatibility:

```powershell
node apps/cindy-headless/dist/cli.cjs profile validate --profile apps/cindy-headless/profiles/cindy-production-codex/profile.example.json
node apps/cindy-headless/dist/cli.cjs compatibility-report --profile apps/cindy-headless/profiles/cindy-production-codex/profile.example.json
node apps/cindy-headless/dist/cli.cjs doctor --profile apps/cindy-headless/profiles/cindy-production-codex/profile.example.json
```

Run a local task:

```powershell
node apps/cindy-headless/dist/cli.cjs run --profile <profile.json> --task "Inspect the repository and report the result" --working-dir . --output-dir results
```

The output directory contains identity, config, trace, usage and result artifacts. Prompt bodies and secrets are excluded. Usage artifacts use schema 2 and explicitly report `COMPLETE`, `PARTIAL` or `MISSING`; timeout results must not be interpreted as exact zero token or cost. They also expose `usageCompleteness`: `exact` for a complete provider event, `lower-bound` for observed partial usage, and `incomplete` when no trustworthy count exists. Reports count these categories separately. Evaluation report schema 2 sets `totals.costUsd` to `null` when any trial has unknown cost; `knownCostUsd`, `costKnownCount` and `costMissingCount` expose the auditable known subtotal. A configured cost budget fails closed with `cost-unknown` instead of silently treating missing cost as zero. A disconnected provider stream is infrastructure failure; it is not converted into an agent failure or an estimated token count.

Harbor's token fields overlap by design: `n_input_tokens = inputTokens + cacheCreationTokens + cacheReadTokens`, `n_cache_tokens = cacheReadTokens`, and `n_output_tokens = outputTokens`. Do not add `n_cache_tokens` to `n_input_tokens` a second time. The original components and completeness flags remain in `usage.json`.

`identity.json.identityEvidence` identifies whether each actual-identity field came from a provider event, configuration, an operator assertion, or is unknown. These are provenance labels, not independent gateway attestation. Unless a gateway supplies a request-ID lookup or signed billing record, Headless cannot independently prove the actual upstream provider/model and records `gatewayAttested: false`.

`trace.raw.jsonl` is the lossless native Cindy event stream. `trace.jsonl` is
the normalized analysis stream: when a provider emits incremental `text` or
`thinking` deltas followed by an `isFinal` snapshot, the earlier deltas are
removed from the normalized stream so downstream analysis does not count the
same content twice. This adapter currently declares `SUPPORTS_ATIF = False`;
consumers that compare trajectories across harnesses need an ATIF converter and
must not parse it as Harbor's standard `trajectory.json`.

## Harbor smoke test

Run the Harbor workspace's hello-world smoke/freeze workflow from its own
repository. Set `--workspace-root` to the Harbor workspace root; job paths must
be relative to that root. Use a unique `run_id` and frozen `manifest_digest`.

## Collect and report results

Harbor writes the raw trial artifacts under its configured jobs/evaluation
output directory. Use the Harbor viewer or its report tooling from the Harbor
checkout to inspect those artifacts, then pass a normalized results file to:

```powershell
node apps/cindy-headless/dist/cli.cjs report --manifest <manifest.json> --results <results.json> > report.json
```

Reports include per-agent and per-benchmark pass rates, paired outcomes, four-state statuses, tokens, cost, duration, provider routing, unsupported combinations and Wilson 95% intervals. A hard-30 list is publishable only after freezing at least 30 independent historical task records with `freeze-hard-30`.

The adapter is intentionally maintained in Harbor, not here. To run a local
smoke from a source checkout:

```powershell
$root = (Resolve-Path ..\harbor).Path # any Harbor checkout; do not hard-code a maintainer path
uv run --project $root harbor eval execute <freeze-id> --workspace-root $root --approve
```

The `<freeze-id>` job must import
`harbor.agents.installed.cindy_headless:CindyHeadlessAgent`. Harbor resolves
the bundle and profile paths relative to `--workspace-root`, so the same job
works after cloning to another directory. Use `harbor-compatibility.json` to
check the required Harbor commit and adapter contract before a scored run.

The `cindy-claude-parity-all-off` profile is a whole-surface parity control. Because it changes Maker Memory, project context, compaction and the Cindy system prompt together, it cannot attribute an outcome to any one dimension. Use a derived profile with exactly one declared `changedDimensions` entry for causal comparisons.

## Maintenance after Cindy updates

Treat Headless as a compatibility surface, not a floating checkout:

1. Update/rebase the Cindy source and inspect changes to `maker-core`, Agent event types, usage, Memory/MCP and Desktop prompt sources.
2. Run typecheck, all tests, prompt parity and compatibility tests.
3. Rebuild the Linux bundle with pinned binaries and run `verify:bundle`.
4. Run the Harbor hello-world smoke test, then a small multi-task pilot before a scored benchmark.
5. Freeze the new bundle manifest and update the pinned commit/digests.

Classify changes as `COMPATIBLE` (rebuild only), `REQUIRES_ADAPTER_UPDATE` (Headless or Harbor code changes), or `UNSUPPORTED` (Desktop-only capability). Do not silently enable new permissions, providers or throughput caps in a scored run.

The release bundle builder refuses a dirty worktree. Commit the reviewed source on a feature branch before rebuilding; `generatedAt` is derived from that commit timestamp, while `cindyCommit` and binary/source digests bind the artifact to the reviewed revision.

### When upstream changed before a smoke test

Do not silently run a newly updated Cindy checkout with an old Headless bundle. Before the smoke test, compare the checked-out Cindy commit with `bundle/linux-x64/bundle-manifest.json.cindyCommit` and choose one of these paths:

1. **Test the previous frozen release:** keep the old Cindy checkout and bundle together, record both revisions, and state that the smoke test covers the previous frozen release. This is valid for regression checks, but it does not validate the new upstream commit.
2. **Upstream change is `COMPATIBLE`:** sync/rebase the change, run all Headless tests, rebuild and verify the bundle, update the frozen manifest digest, then run Harbor smoke. Typical examples are internal `maker-core` fixes that preserve public contracts.
3. **Change is `REQUIRES_ADAPTER_UPDATE`:** stop the scored run. Update Headless and/or the Harbor adapter, add contract regression tests, rebuild the bundle, run smoke and a small pilot, then freeze new revisions. This applies to changes in Agent APIs, event/usage schemas, Memory/MCP behavior, profiles, permissions or provider routing.
4. **Change is `UNSUPPORTED`:** do not imitate or partially enable it in Headless. Record the Desktop-only capability and applicable scope in the compatibility/report output.

Before any scored benchmark, freeze and verify the Cindy commit, Headless commit, bundle manifest digest, Agent binary versions, prompt digests, profile digest, model/endpoint and Benchmark revision. If any one of these differs from the planned run, regenerate the plan or stop the run; never mix a new source checkout with artifacts from an older bundle.

## Profiles

`model.contextLimit` is optional. When present, Headless injects that exact
context window into Maker Core for the selected model; when omitted, the
underlying Agent/model capability remains authoritative. This setting controls
Headless context accounting and compaction thresholds, but does not increase an
upstream model or gateway's actual context capacity.

`run --timeout-ms` is enforced by Headless itself. When the flag is omitted,
the standalone default is **1800 seconds (1,800,000 ms)**. This default is a
fallback for direct CLI use; it is not a second independent benchmark policy.

When Harbor owns the run, Harbor's `execution_timeout_sec` is authoritative and
the Cindy Harbor adapter must pass an explicit Headless deadline slightly
earlier (currently five seconds earlier, with a minimum of one second). This
leaves time to abort the Agent and persist partial usage and trace artifacts
before Harbor terminates the container. Headless derives the Maker turn-stall
watchdog from the effective `--timeout-ms` and records both `timeoutMs` and
`turnStallMs` in `config.json`. Do not remove the adapter argument or rely on
the 1800-second fallback for a Harbor run.

For example, a 1800-second Harbor deadline produces a 1795-second Headless
deadline and a 1436-second watchdog. A direct invocation without the flag uses
1800 seconds and a 1440-second watchdog.

## Building a usable Harbor package

Build and verify a release only from a clean, committed feature branch. The
bundle must be Linux x64 for Docker and must include the matching profile,
`dist/cli.cjs`, `bundle/`, prompt files, and bundle manifest. Record the source
commit, bundle SHA-256, profile SHA-256, Cindy/Claude binary versions, model,
endpoint, and timeout in the runtime manifest. Never mix a newly built bundle
with an older profile or upload an unverified local directory.

Minimum release checks:

```powershell
pnpm --filter cindy-headless typecheck
pnpm --filter cindy-headless test
pnpm --filter cindy-headless build
pnpm --filter cindy-headless verify:bundle
```

Register the resulting runtime in Headless Benchmark Tool, run package
verification, and require `READY` before a Harbor benchmark. A one-task Harbor
smoke should verify `config.json`, `identity.json`, `result.json`, `usage.json`,
`trace.jsonl`, and `trace.raw.jsonl`; only then publish the bundle and its
manifest to the private releases repository. The release README must preserve
these exact digests and the command used to reproduce the package.

The Kimi gateway examples are
`profiles/cindy-production-claude/profile.kimi-k3.example.json` and
`profiles/cindy-claude-parity-all-off/profile.kimi-k3.example.json`. They pin a
1M declared context window; supply gateway credentials through the ignored
local config file, never by editing these tracked profiles.

For the DeepSeek smoke campaign, use
  `profiles/cindy-production-claude/profile.deepseek-v4-flash.example.json`.
It pins `deepseek/deepseek-v4-flash` and a 1,048,576-token declared context
window. The gateway must actually advertise/support this model; the profile
does not turn a gateway route into an independent model attestation.

Production profiles are pinned and should be changed only for an explicit experiment:

- `cindy-production-claude`
- `cindy-production-codex`
- `cindy-native-memory`
- `cindy-planning`
- `cindy-no-compaction`
- `cindy-tool-surface`

Keep `profile.local-smoke.json` restricted to local testing. In particular, unsandboxed bypass permission is explicitly unsafe and must never be used for untrusted benchmark tasks.
