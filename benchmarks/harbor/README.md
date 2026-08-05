# Cindy Headless Harbor adapter

完整的 Headless 使用、构建和维护说明见 [`apps/cindy-headless/README.md`](../../apps/cindy-headless/README.md)。

This directory targets Harbor 0.20 and uses its custom `agent.import_path` mechanism.

The adapter intentionally uploads a prebuilt Linux bundle. It does not run `pnpm install`, download Claude Code, or resolve floating versions inside a scored trial. Build and fingerprint the bundle before running Harbor.

Use the wrapper so Harbor can import the adapter reliably on Windows and Linux:

```powershell
./run-smoke.ps1
```

Run the Codex API-key variant with the same gateway credential:

```powershell
./run-smoke.ps1 -Config ./job.codex.example.yaml
```

The wrapper reads the ignored `apps/cindy-headless/config.local.json` when Cindy
gateway environment variables are absent, sets `PYTHONPATH` to the repository root,
and forces UTF-8 output. For a
formal run, replace the example manifest digest with the exact `manifestDigest`
emitted by `cindy-headless-eval plan` before starting Harbor; never hand-edit it.

The example job uses the parity-tested profile under `apps/cindy-headless/profiles`. The adapter uploads the whole profile directory so relative prompt files remain resolvable. Freeze the exact model, endpoint route, prompt digest, selected Agent binary version, Cindy commit, and bundle digest before a scored run. Claude profiles use the pinned Claude binary. Codex profiles use the pinned Codex app-server binary and accept either the unified gateway API key or `kwargs.codex_home_dir` pointing at an explicit isolated home. Secrets must not be written into the profile, bundle, repository, or result artifacts.
## Evaluation controls

The benchmark manifest supports deterministic scheduling and execution policy:

- `retry.agent` is fixed at `0`; `retry.infra` may be `0` or `1` and only infrastructure errors may be retried.
- `budget.maxCostUsd` and `budget.stopAfterFailures` are stop conditions evaluated by the runner after every trial.
- `agentOrder` defines the arm order inside a paired task; task/repetition groups are shuffled with the manifest `seed`.
- `concurrency` is the runner's concurrency contract and must match Harbor's `n_concurrent_trials`.
- `throughputCap.enabled` defaults to `false`. When enabled, an external proxy must enforce the declared rate and provide timing evidence; the Cindy process does not claim to enforce it internally.

Each generated cell has a stable `cellId`. The Headless result and identity artifacts also include `runId`, `cellId`, `attemptId`, `manifestDigest`, the standardized result class, retry relationship, and runtime/provider version fields. Secrets and prompt bodies are intentionally excluded.

## Post-run report

After collecting the normalized `result.json` records into an array, generate the auditable report with:

First collect Harbor trial artifacts (the collector never reads secrets or prompt bodies):

```powershell
python benchmarks/harbor/collect_results.py D:/Tools/Harbor/jobs/<job> results.json
```

```powershell
node apps/cindy-headless/dist/cli.cjs report --manifest manifest.json --results results.json > report.json
```

The report includes per-Benchmark and per-Agent pass rates, paired outcomes, four-state failure counts, token/cost/duration totals, upstream provider counts, Wilson 95% intervals, and unsupported combinations. A hard-30 list must be frozen separately from independent historical data:

```powershell
node apps/cindy-headless/dist/cli.cjs freeze-hard-30 --historical historical-solve-rates.json > hard-30.json
```

The command refuses to publish a hard-30 list unless at least 30 independent historical task records are supplied.
