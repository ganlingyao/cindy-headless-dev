# Cindy Headless

Cindy Headless is Cindy's container-friendly runtime. It reuses Cindy's `maker-core` and MCP contracts, then exposes the Claude Code and Codex harnesses through a CLI and a Harbor `BaseAgent` adapter. It does not recreate Cindy Desktop, Electron UI, or the Agent binaries.

## Quick start

Authorized internal users can download the current package from the private [Cindy Headless v0.1.3 release](https://github.com/ganlingyao/cindy-headless-releases/releases/tag/cindy-headless-v0.1.3). The dedicated release repository contains both runtime and access-controlled full packages. Verify the selected archive with the attached `SHA256SUMS` before extraction.

From a source checkout on Windows:

```powershell
Copy-Item apps/cindy-headless/config.example.json apps/cindy-headless/config.local.json
# Set the gateway URL/key in the ignored config.local.json.
./apps/cindy-headless/scripts/setup.ps1
./benchmarks/harbor/run-smoke.ps1 -Backend codex
```

From the runtime GitHub Release asset, extract `cindy-headless-linux-x64-runtime-<version>.tar.gz`, configure the gateway, and run `prepare-binaries.ps1` or `prepare-binaries.sh`. The public archive is the Cindy Headless runtime, not a Claude Code or Codex redistribution. The preparation script downloads the exact pinned Agent runtimes from their official sources and verifies SHA-256 before use.

## Layout

```text
apps/cindy-headless/src/       Runtime, profiles, benchmark and artifact code
apps/cindy-headless/profiles/  Pinned backend/model/profile definitions
apps/cindy-headless/scripts/   Bundle and compatibility verification scripts
apps/cindy-headless/bundle/    Reproducible Linux x64 bundle output
benchmarks/harbor/              Harbor adapter, jobs, collector and smoke wrapper
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

The extracted distribution uses `cindy_harbor/` for its Harbor adapter. This distinct Python package name is required: naming it `harbor/` would shadow Harbor's own CLI package when the distribution root is added to `PYTHONPATH`. Run the packaged smoke wrapper from `cindy_harbor/run-smoke.ps1` or `cindy_harbor/run-smoke.sh`.

Treat this as an internal artifact, not a public GitHub Release asset. Store it only in an access-controlled artifact system, retain `VENDOR-BINARIES-NOTICE.txt`, and review the applicable vendor redistribution terms before sharing it outside the organization. The included `prepare-binaries` scripts remain available for repairing or refreshing the pinned binaries, but are not required for the first run of a verified full package.

Before publishing, run `scripts/verify-clean-install.ps1` from a pushed branch. It clones into a temporary directory and verifies that the documented source workflow does not depend on the maintainer's working tree. Add `-RunSmoke` when gateway credentials and Harbor are available.

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

The output directory contains identity, config, trace, usage and result artifacts. Prompt bodies and secrets are excluded.

## Harbor smoke test

From `benchmarks/harbor` run the wrapper. It loads the ignored local gateway config, generates a machine-local Harbor YAML without credentials, sets `PYTHONPATH` and UTF-8 output, invokes Harbor, then collects normalized results:

```powershell
./run-smoke.ps1 -Config ./job.codex.example.yaml
```

Use a unique `run_id` and a frozen `manifest_digest` for scored runs. The adapter preserves `attempt-1` and `attempt-2`; only infrastructure errors may be retried once. Agent failures and invalid tasks are not retried.

## Collect and report results

```powershell
python benchmarks/harbor/collect_results.py D:/Tools/Harbor/jobs/<job> results.json
node apps/cindy-headless/dist/cli.cjs report --manifest <manifest.json> --results results.json > report.json
```

Reports include per-agent and per-benchmark pass rates, paired outcomes, four-state statuses, tokens, cost, duration, provider routing, unsupported combinations and Wilson 95% intervals. A hard-30 list is publishable only after freezing at least 30 independent historical task records with `freeze-hard-30`.

## Maintenance after Cindy updates

Treat Headless as a compatibility surface, not a floating checkout:

1. Update/rebase the Cindy source and inspect changes to `maker-core`, Agent event types, usage, Memory/MCP and Desktop prompt sources.
2. Run typecheck, all tests, prompt parity and compatibility tests.
3. Rebuild the Linux bundle with pinned binaries and run `verify:bundle`.
4. Run the Harbor hello-world smoke test, then a small multi-task pilot before a scored benchmark.
5. Freeze the new bundle manifest and update the pinned commit/digests.

Classify changes as `COMPATIBLE` (rebuild only), `REQUIRES_ADAPTER_UPDATE` (Headless or Harbor code changes), or `UNSUPPORTED` (Desktop-only capability). Do not silently enable new permissions, providers or throughput caps in a scored run.

### When upstream changed before a smoke test

Do not silently run a newly updated Cindy checkout with an old Headless bundle. Before the smoke test, compare the checked-out Cindy commit with `bundle/linux-x64/bundle-manifest.json.cindyCommit` and choose one of these paths:

1. **Test the previous frozen release:** keep the old Cindy checkout and bundle together, record both revisions, and state that the smoke test covers the previous frozen release. This is valid for regression checks, but it does not validate the new upstream commit.
2. **Upstream change is `COMPATIBLE`:** sync/rebase the change, run all Headless tests, rebuild and verify the bundle, update the frozen manifest digest, then run Harbor smoke. Typical examples are internal `maker-core` fixes that preserve public contracts.
3. **Change is `REQUIRES_ADAPTER_UPDATE`:** stop the scored run. Update Headless and/or the Harbor adapter, add contract regression tests, rebuild the bundle, run smoke and a small pilot, then freeze new revisions. This applies to changes in Agent APIs, event/usage schemas, Memory/MCP behavior, profiles, permissions or provider routing.
4. **Change is `UNSUPPORTED`:** do not imitate or partially enable it in Headless. Record the Desktop-only capability and applicable scope in the compatibility/report output.

Before any scored benchmark, freeze and verify the Cindy commit, Headless commit, bundle manifest digest, Agent binary versions, prompt digests, profile digest, model/endpoint and Benchmark revision. If any one of these differs from the planned run, regenerate the plan or stop the run; never mix a new source checkout with artifacts from an older bundle.

## Profiles

Production profiles are pinned and should be changed only for an explicit experiment:

- `cindy-production-claude`
- `cindy-production-codex`
- `cindy-native-memory`
- `cindy-planning`
- `cindy-no-compaction`
- `cindy-tool-surface`

Keep `profile.local-smoke.json` restricted to local testing. In particular, unsandboxed bypass permission is explicitly unsafe and must never be used for untrusted benchmark tasks.
