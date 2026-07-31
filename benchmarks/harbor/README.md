# Cindy Headless Harbor adapter

This directory targets Harbor 0.20 and uses its custom `agent.import_path` mechanism.

The adapter intentionally uploads a prebuilt Linux bundle. It does not run `pnpm install`, download Claude Code, or resolve floating versions inside a scored trial. Build and fingerprint the bundle before running Harbor.

Run from this directory so Python can import `cindy_headless_agent.py`:

```powershell
harbor run --config job.example.yaml
```

The example job uses the parity-tested profile under `apps/cindy-headless/profiles`. The adapter uploads the whole profile directory so relative prompt files remain resolvable. Freeze the exact model, endpoint route, prompt digest, selected Agent binary version, Cindy commit, and bundle digest before a scored run. Claude profiles use the pinned Claude binary; Codex profiles use the pinned Codex app-server binary and require an isolated `CINDY_HEADLESS_CODEX_HOME` mount. Secrets are supplied only through environment expansion and must not be written into the profile or bundle.
