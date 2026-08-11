# Cindy Headless Harbor Adapter

Harbor 0.20 agent adapter for Cindy Headless evaluation runs. Drop these files into a
Harbor checkout to run Cindy Headless as a Harbor installed agent.

## Files

| File | Role |
|------|------|
| `cindy_headless.py` | Adapter — replaces `src/harbor/agents/installed/cindy_headless.py` |
| `test_cindy_headless.py` | Unit tests — replaces `tests/unit/agents/installed/test_cindy_headless.py` |
| `context.py` | Patched `AgentContext` — replaces `src/harbor/models/agent/context.py` |

## What changed vs upstream Harbor

### P0 fixes

- **Working directory resolution**. The adapter no longer hardcodes `/app`. It
  resolves the task image's actual `WORKDIR` via `pwd` and verifies it exists and
  is writable before passing it to the Cindy Headless binary.

- **Deadline propagation**. Harbor's `execution_timeout_sec` is forwarded to
  Cindy Headless with a 5-second grace period so the inner process has time to
  flush its SDK stream and persist usage/trace artifacts before the outer
  deadline fires.

- **Post-run usage preservation**. On timeout or cancellation, `populate_context_post_run`
  still runs so partial token counts are not lost.

- **Zero-value token persistence**. Observed `cache_creation_input_tokens = 0` is
  kept as a value, not treated as missing. This prevents false "MISSING" reports
  for providers that genuinely report zero cache-creation tokens.

- **Cost propagation for PARTIAL usage**. When usage is PARTIAL but cost was
  observed (not in `missingFields`), the adapter now propagates the value instead
  of discarding it as `null`.

### Installation

1. Copy the three files to the corresponding paths in your Harbor checkout:
   ```bash
   cp adapter/cindy_headless.py   src/harbor/agents/installed/cindy_headless.py
   cp adapter/test_cindy_headless.py  tests/unit/agents/installed/test_cindy_headless.py
   cp adapter/context.py          src/harbor/models/agent/context.py
   ```

2. Run the unit tests:
   ```bash
   python -m pytest tests/unit/agents/installed/test_cindy_headless.py -v
   ```

3. The `context.py` patch adds a `_execution_timeout_sec` private attribute to
   `AgentContext`. This is a minimal, additive change — other Harbor agents are
   unaffected.

### Version compatibility

- Harbor ≥ 0.20.0
- Cindy Headless ≥ 0.1.7
- Python ≥ 3.11
