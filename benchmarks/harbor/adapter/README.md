# Cindy Headless Adapter

Harbor-side adapter for running Cindy Headless benchmarks. These files are
sourced from the Harbor repository and kept in lockstep with the Harbor
`fix/cindy-adapter-eval-contract` branch.

## Files

| File | Source (Harbor) | Purpose |
|------|-----------------|---------|
| `cindy_headless.py` | `src/harbor/agents/installed/cindy_headless.py` | Headless runtime adapter — launches Cindy Headless CLI inside the trial container |
| `test_cindy_headless.py` | `tests/unit/agents/installed/test_cindy_headless.py` | Unit tests for the adapter |
| `context.py` | `src/harbor/models/agent/context.py` | AgentContext model with `harbor_agent_timeout_sec` metadata field |

## Timeout enforcement

The adapter enforces the runtime deadline through two mechanisms:

1. **Inner grace margin**: `--timeout-ms` is set to `(timeout_sec - 5) * 1000` so Headless
   has 5 seconds to flush usage/trace before the outer Harbor deadline fires
2. **Outer deadline**: `timeout_sec` is passed to container execution, replacing the
   old `timeout_sec=None` default

Together with the Harbor trial's `agent_task.cancel()` (hard timeout) and the
Headless host's force-kill on deadline, this forms a three-layer defence against
runaway agent processes.

## Syncing with Harbor

When the Harbor side changes, copy the updated files here:

```bash
cp $HARBOR/src/harbor/agents/installed/cindy_headless.py benchmarks/harbor/adapter/cindy_headless.py
cp $HARBOR/tests/unit/agents/installed/test_cindy_headless.py benchmarks/harbor/adapter/test_cindy_headless.py
cp $HARBOR/src/harbor/models/agent/context.py benchmarks/harbor/adapter/context.py
```
