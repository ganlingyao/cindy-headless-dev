# Cindy Headless Adapter

Harbor-side adapter for running Cindy Headless benchmarks. These files are
sourced from the Harbor repository and kept in lockstep with the Harbor
`fix/cindy-adapter-eval-contract` branch.

## Files

| File | Source (Harbor) | Purpose |
|------|-----------------|---------|
| `cindy_headless.py` | `src/harbor/agents/installed/cindy_headless.py` | Headless runtime adapter — launches Cindy Headless CLI inside the trial container |
| `test_cindy_headless.py` | `tests/unit/agents/installed/test_cindy_headless.py` | Unit tests for the adapter |
| `context.py` | `src/harbor/models/agent/context.py` | AgentContext model with the private execution deadline passed by Harbor |

This directory is a reviewable snapshot of a Harbor integration patch, not a
drop-in replacement for only one Harbor module. Full built-in Agent support
also requires the matching Harbor changes to `models/agent/name.py`,
`agents/factory.py`, and the evaluation runner that calls
`AgentContext.set_execution_timeout_sec()`. Without those patches the adapter
can still be imported by a custom `import_path`, but Harbor will not supply its
outer trial deadline through `AgentContext`.

## Timeout enforcement

The adapter enforces the runtime deadline through two mechanisms:

1. **Inner grace margin**: `--timeout-ms` is set to `(timeout_sec - 5) * 1000` so Headless
   has 5 seconds to flush usage/trace before the outer Harbor deadline fires
2. **Outer deadline**: `timeout_sec` is passed to container execution, replacing the
   old `timeout_sec=None` default

Together with Headless's own `--timeout-ms` timer and the Harbor trial's hard
task cancellation, this forms a three-layer defence against runaway processes.

## Syncing with Harbor

When the Harbor side changes, copy the updated files here:

```bash
cp $HARBOR/src/harbor/agents/installed/cindy_headless.py benchmarks/harbor/adapter/cindy_headless.py
cp $HARBOR/tests/unit/agents/installed/test_cindy_headless.py benchmarks/harbor/adapter/test_cindy_headless.py
cp $HARBOR/src/harbor/models/agent/context.py benchmarks/harbor/adapter/context.py
```

After syncing, also review the corresponding Harbor factory, AgentName, and
evaluation-runner commits. Comparing only these three copied files is not
sufficient to prove that the integration contract remains complete.
