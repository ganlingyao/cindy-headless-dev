# Cindy Headless Harbor adapter

This directory targets Harbor 0.20 and uses its custom `agent.import_path` mechanism.

The adapter intentionally uploads a prebuilt Linux bundle. It does not run `pnpm install`, download Claude Code, or resolve floating versions inside a scored trial. Build and fingerprint the bundle before running Harbor.

Run from this directory so Python can import `cindy_headless_agent.py`:

```powershell
harbor run --config job.example.yaml
```

The example job uses the parity-tested profile under `apps/cindy-headless/profiles`. The adapter uploads the whole profile directory so relative prompt files remain resolvable. Freeze the exact model, endpoint route, prompt digest, selected Agent binary version, Cindy commit, and bundle digest before a scored run. Claude profiles use the pinned Claude binary. Codex profiles use the pinned Codex app-server binary and require `kwargs.codex_home_dir` to point at an explicit isolated home; the adapter uploads it to the container and sets `CINDY_HEADLESS_CODEX_HOME`. Secrets must not be written into the profile, bundle, repository, or result artifacts.
## Evaluation controls

The benchmark manifest supports deterministic scheduling and execution policy:

- `retry.agent` is fixed at `0`; `retry.infra` may be `0` or `1` and only infrastructure errors may be retried.
- `budget.maxCostUsd` and `budget.stopAfterFailures` are stop conditions evaluated by the runner after every trial.
- `agentOrder` defines the arm order inside a paired task; task/repetition groups are shuffled with the manifest `seed`.
- `concurrency` is the runner's concurrency contract and must match Harbor's `n_concurrent_trials`.
- `throughputCap.enabled` defaults to `false`. When enabled, an external proxy must enforce the declared rate and provide timing evidence; the Cindy process does not claim to enforce it internally.

Each generated cell has a stable `cellId`. The Headless result and identity artifacts also include `runId`, `cellId`, `attemptId`, `manifestDigest`, the standardized result class, retry relationship, and runtime/provider version fields. Secrets and prompt bodies are intentionally excluded.
