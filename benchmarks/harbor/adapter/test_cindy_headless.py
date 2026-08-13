import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest

from harbor.agents.factory import AgentFactory
from harbor.agents.installed.cindy_headless import (
    CindyHeadlessAgent,
    _model_matches,
    _sha256_file,
)
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.agent.name import AgentName
from harbor.models.trial.config import AgentConfig
from harbor.evaluation.runner import _validate_frozen_agent_inputs


def _write_fixture(tmp_path: Path) -> tuple[Path, Path]:
    bundle = tmp_path / "bundle"
    (bundle / "bin").mkdir(parents=True)
    (bundle / "dist").mkdir()
    for relative in (
        "bin/claude",
        "bin/codex",
        "bin/node",
        "dist/cli.cjs",
        "prompt.md",
        "codex-prompt.md",
    ):
        (bundle / relative).write_bytes(b"fixture")
    manifest = {
        "schemaVersion": 4,
        "headlessContractVersion": 1,
        "cindyHeadlessVersion": "0.1.0",
        "cindyCommit": "1" * 40,
        "claudeCodeVersion": "2.1.219",
        "codexVersion": "0.145.0",
        "nodeVersion": "22.22.0",
        "cliDigest": _sha256_file(bundle / "dist/cli.cjs").removeprefix("sha256:"),
        "systemPromptDigest": _sha256_file(bundle / "prompt.md").removeprefix(
            "sha256:"
        ),
        "codexSystemPromptDigest": _sha256_file(
            bundle / "codex-prompt.md"
        ).removeprefix("sha256:"),
        "claudeBinaryDigest": _sha256_file(bundle / "bin/claude").removeprefix(
            "sha256:"
        ),
        "codexBinaryDigest": _sha256_file(bundle / "bin/codex").removeprefix("sha256:"),
        "nodeBinaryDigest": _sha256_file(bundle / "bin/node").removeprefix("sha256:"),
    }
    (bundle / "bundle-manifest.json").write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )
    profile = tmp_path / "profile.json"
    profile.write_text(
        json.dumps(
            {
                "id": "fixture-profile",
                "version": 1,
                "agentBackend": "claude-code",
                "agentBinaryPath": "/opt/cindy-headless/bin/claude",
                "agentBinaryVersion": "2.1.219",
                "supportedModelIds": ["moonshot/kimi-k3"],
                "model": {"requestedId": "moonshot/kimi-k3"},
                "systemPromptFile": "prompt.md",
                "containerSandbox": True,
            }
        ),
        encoding="utf-8",
    )
    return bundle, profile


def _agent(
    tmp_path: Path,
    *,
    extra_env: dict[str, str] | None = None,
) -> CindyHeadlessAgent:
    bundle, profile = _write_fixture(tmp_path)
    return CindyHeadlessAgent(
        logs_dir=tmp_path / "logs",
        model_name="moonshot/kimi-k3",
        bundle_dir=str(bundle),
        profile_path=str(profile),
        bundle_manifest_sha256=_sha256_file(bundle / "bundle-manifest.json"),
        profile_sha256=_sha256_file(profile),
        extra_env=extra_env,
    )


class _FakeEnvironment:
    def __init__(self, return_codes: list[int] | None = None) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.dir_uploads: list[tuple[Path, str]] = []
        self.file_uploads: list[tuple[Path, str]] = []
        self.return_codes = list(return_codes or [])

    async def upload_dir(self, source: Path, target: str) -> None:
        self.dir_uploads.append((source, target))

    async def upload_file(self, source: Path, target: str) -> None:
        self.file_uploads.append((source, target))

    async def exec(self, command: str, **kwargs: object) -> SimpleNamespace:
        self.calls.append((command, kwargs))
        return_code = self.return_codes.pop(0) if self.return_codes else 0
        return SimpleNamespace(
            return_code=return_code,
            stdout="/workspace\n" if command == "pwd" else "fixture stdout",
            stderr="fixture stderr" if return_code else "",
        )


def test_factory_registers_cindy_production() -> None:
    assert (
        AgentFactory.get_agent_class(AgentName.CINDY_PRODUCTION) is CindyHeadlessAgent
    )


def test_namespaced_model_requires_an_exact_match() -> None:
    assert _model_matches("moonshot/kimi-k3", "moonshot/kimi-k3")
    assert not _model_matches("other/kimi-k3", "moonshot/kimi-k3")
    assert _model_matches("anthropic/claude-sonnet-4-6", "claude-sonnet-4-6")


def test_adapter_freezes_bundle_profile_and_model_contract(tmp_path: Path) -> None:
    agent = _agent(tmp_path)
    assert agent.name() == "cindy-production"
    assert agent.cindy_commit == "1" * 40
    assert agent.system_prompt_digest == _sha256_file(
        agent.bundle_dir / "prompt.md"
    ).removeprefix("sha256:")
    assert agent.supported_model_ids(
        harness_version="0.1.0",
        provider="moonshot",
        requested_model="moonshot/kimi-k3",
        endpoint_host="gateway.example.com",
    ) == ("moonshot/kimi-k3",)


def test_adapter_rejects_digest_drift(tmp_path: Path) -> None:
    bundle, profile = _write_fixture(tmp_path)
    with pytest.raises(ValueError, match="profile digest mismatch"):
        CindyHeadlessAgent(
            logs_dir=tmp_path / "logs",
            model_name="moonshot/kimi-k3",
            bundle_dir=str(bundle),
            profile_path=str(profile),
            bundle_manifest_sha256=_sha256_file(bundle / "bundle-manifest.json"),
            profile_sha256="sha256:" + "0" * 64,
        )


def test_adapter_rejects_bundle_member_drift(tmp_path: Path) -> None:
    bundle, profile = _write_fixture(tmp_path)
    manifest_digest = _sha256_file(bundle / "bundle-manifest.json")
    (bundle / "dist/cli.cjs").write_bytes(b"changed after manifest freeze")

    with pytest.raises(ValueError, match="bundle cliDigest mismatch"):
        CindyHeadlessAgent(
            logs_dir=tmp_path / "logs",
            model_name="moonshot/kimi-k3",
            bundle_dir=str(bundle),
            profile_path=str(profile),
            bundle_manifest_sha256=manifest_digest,
            profile_sha256=_sha256_file(profile),
        )


def test_frozen_inputs_validate_without_credentials(tmp_path: Path) -> None:
    bundle, profile = _write_fixture(tmp_path)
    frozen = CindyHeadlessAgent.validate_frozen_config(
        bundle_dir=str(bundle),
        profile_path=str(profile),
        bundle_manifest_sha256=_sha256_file(bundle / "bundle-manifest.json"),
        profile_sha256=_sha256_file(profile),
    )
    assert frozen == {
        "cindy_version": "0.1.0",
        "cindy_commit": "1" * 40,
        "profile_id": "fixture-profile",
        "requested_model": "moonshot/kimi-k3",
        "agent_backend": "claude-code",
        "system_prompt_digest": _sha256_file(bundle / "prompt.md"),
        "bundle_manifest_digest": _sha256_file(bundle / "bundle-manifest.json"),
        "profile_digest": _sha256_file(profile),
    }


def test_development_claude_bundle_requires_explicit_opt_in(tmp_path: Path) -> None:
    bundle, profile = _write_fixture(tmp_path)
    manifest_path = bundle / "bundle-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update(
        {
            "bundleMode": "development",
            "agentBackend": "claude-code",
        }
    )
    manifest.pop("codexVersion")
    manifest.pop("codexSystemPromptDigest")
    manifest.pop("codexBinaryDigest")
    (bundle / "bin/codex").unlink()
    (bundle / "codex-prompt.md").unlink()
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    kwargs = {
        "bundle_dir": str(bundle),
        "profile_path": str(profile),
        "bundle_manifest_sha256": _sha256_file(manifest_path),
        "profile_sha256": _sha256_file(profile),
    }

    with pytest.raises(ValueError, match="development_bundle=true"):
        CindyHeadlessAgent.validate_frozen_config(**kwargs)

    frozen = CindyHeadlessAgent.validate_frozen_config(
        **kwargs,
        development_bundle=True,
    )
    assert frozen["agent_backend"] == "claude-code"


def test_derived_profile_can_explicitly_disable_system_prompt(
    tmp_path: Path,
) -> None:
    bundle, profile = _write_fixture(tmp_path)
    manifest_path = bundle / "bundle-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update(
        {
            "bundleMode": "development",
            "agentBackend": "claude-code",
        }
    )
    manifest.pop("codexVersion")
    manifest.pop("codexSystemPromptDigest")
    manifest.pop("codexBinaryDigest")
    (bundle / "bin/codex").unlink()
    (bundle / "codex-prompt.md").unlink()
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    profile_payload = json.loads(profile.read_text(encoding="utf-8"))
    profile_payload.pop("systemPromptFile")
    profile_payload["changedDimensions"] = ["systemPrompt"]
    profile.write_text(json.dumps(profile_payload), encoding="utf-8")

    frozen = CindyHeadlessAgent.validate_frozen_config(
        bundle_dir=str(bundle),
        profile_path=str(profile),
        bundle_manifest_sha256=_sha256_file(manifest_path),
        profile_sha256=_sha256_file(profile),
        development_bundle=True,
    )

    assert frozen["system_prompt_digest"] is None

    formal_bundle, formal_profile = _write_fixture(tmp_path / "formal")
    formal_profile_payload = json.loads(formal_profile.read_text(encoding="utf-8"))
    formal_profile_payload.pop("systemPromptFile")
    formal_profile_payload["changedDimensions"] = ["systemPrompt"]
    formal_profile.write_text(json.dumps(formal_profile_payload), encoding="utf-8")
    formal = CindyHeadlessAgent.validate_frozen_config(
        bundle_dir=str(formal_bundle),
        profile_path=str(formal_profile),
        bundle_manifest_sha256=_sha256_file(
            formal_bundle / "bundle-manifest.json"
        ),
        profile_sha256=_sha256_file(formal_profile),
    )
    assert formal["system_prompt_digest"] is None


def test_formal_freeze_matches_manifest_provenance(tmp_path: Path) -> None:
    bundle, profile = _write_fixture(tmp_path)
    agent = AgentConfig(
        name="cindy-production",
        model_name="moonshot/kimi-k3",
        kwargs={
            "version": "0.1.0",
            "bundle_dir": "bundle",
            "profile_path": "profile.json",
            "bundle_manifest_sha256": _sha256_file(bundle / "bundle-manifest.json"),
            "profile_sha256": _sha256_file(profile),
        },
    )
    manifest = SimpleNamespace(
        provenance=SimpleNamespace(
            cindy_version="0.1.0",
            cindy_commit="1" * 40,
        )
    )
    variant = SimpleNamespace(
        profile="fixture-profile",
        harness_commit="1" * 40,
        harness_version="0.1.0",
        requested_model="moonshot/kimi-k3",
    )

    previous_cwd = Path.cwd()
    try:
        import os

        os.chdir(tmp_path)
        _validate_frozen_agent_inputs(  # type: ignore[arg-type]
            manifest,
            variant,
            agent,
        )

        variant.requested_model = "other/model"
        with pytest.raises(ValueError, match="requested_model"):
            _validate_frozen_agent_inputs(  # type: ignore[arg-type]
                manifest,
                variant,
                agent,
            )
    finally:
        os.chdir(previous_cwd)


def test_formal_freeze_rejects_machine_specific_paths(tmp_path: Path) -> None:
    bundle, profile = _write_fixture(tmp_path)
    agent = AgentConfig(
        name="cindy-production",
        model_name="moonshot/kimi-k3",
        kwargs={
            "version": "0.1.0",
            "bundle_dir": str(bundle),
            "profile_path": str(profile),
            "bundle_manifest_sha256": _sha256_file(bundle / "bundle-manifest.json"),
            "profile_sha256": _sha256_file(profile),
        },
    )
    manifest = SimpleNamespace(
        provenance=SimpleNamespace(
            cindy_version="0.1.0",
            cindy_commit="1" * 40,
        )
    )
    variant = SimpleNamespace(
        profile="fixture-profile",
        harness_commit="1" * 40,
        harness_version="0.1.0",
        requested_model="moonshot/kimi-k3",
    )

    with pytest.raises(ValueError, match="workspace-relative"):
        _validate_frozen_agent_inputs(  # type: ignore[arg-type]
            manifest,
            variant,
            agent,
        )


def test_setup_uploads_only_frozen_inputs_and_runs_doctor(tmp_path: Path) -> None:
    agent = _agent(
        tmp_path,
        extra_env={"CINDY_HEADLESS_API_KEY": "fixture-secret"},
    )
    environment = _FakeEnvironment()

    asyncio.run(agent.setup(cast(BaseEnvironment, environment)))

    assert environment.dir_uploads == [
        (agent.bundle_dir, "/opt/cindy-headless"),
    ]
    assert environment.file_uploads == [
        (agent.profile_path, "/opt/cindy-headless/profile.json"),
    ]
    assert len(environment.calls) == 3
    assert environment.calls[0][0] == "pwd"
    assert environment.calls[1][0] == "test -d /workspace && test -w /workspace"
    command, kwargs = environment.calls[2]
    assert "dist/cli.cjs doctor" in command
    assert "/opt/cindy-headless/bin/node" in command
    assert "--profile /opt/cindy-headless/profile.json" in command
    assert "--output-dir /logs/agent" in command
    assert "--working-dir /workspace" in command
    doctor_env = cast(dict[str, str], kwargs["env"])
    assert doctor_env["CINDY_EXPECTED_SYSTEM_PROMPT_DIGEST"] == (
        agent.system_prompt_digest
    )


def test_run_uses_outer_attempt_identity_and_does_not_retry(tmp_path: Path) -> None:
    digest = "sha256:" + "3" * 64
    agent = _agent(
        tmp_path,
        extra_env={
            "CINDY_HEADLESS_API_KEY": "fixture-secret",
            "CINDY_MANIFEST_DIGEST": digest,
            "CINDY_RUN_ID": "run-1",
            "CINDY_CELL_ID": "cell-1",
            "CINDY_ATTEMPT_ID": "attempt-2",
            "CINDY_RETRY_COUNT": "1",
            "CINDY_REPLACES_ATTEMPT_ID": "attempt-1",
        },
    )
    environment = _FakeEnvironment()

    context = AgentContext(metadata={"task_id": "terminal-bench/fix-git"})
    context.set_execution_timeout_sec(1800)
    asyncio.run(
        agent.run(
            "offline fixture",
            cast(BaseEnvironment, environment),
            context,
        )
    )

    assert len(environment.calls) == 4
    command, kwargs = environment.calls[0]
    assert command == "pwd"
    command, kwargs = environment.calls[2]
    assert "--working-dir /workspace" in command
    assert "--timeout-ms 1795000" in command
    assert kwargs["timeout_sec"] == 1800
    runtime_env = cast(dict[str, str], kwargs["env"])
    assert runtime_env["CINDY_MANIFEST_DIGEST"] == digest
    assert runtime_env["CINDY_RUN_ID"] == "run-1"
    assert runtime_env["CINDY_CELL_ID"] == "cell-1"
    assert runtime_env["CINDY_ATTEMPT_ID"] == "attempt-2"
    assert runtime_env["CINDY_RETRY_COUNT"] == "1"
    assert runtime_env["CINDY_REPLACES_ATTEMPT_ID"] == "attempt-1"
    assert environment.calls[3][0] == "rm -rf /logs/agent/state"
    assert context.metadata == {"task_id": "terminal-bench/fix-git"}
    assert context.execution_timeout_sec == 1800


def test_run_rejects_model_mismatch_before_execution(tmp_path: Path) -> None:
    agent = _agent(tmp_path)
    agent.model_name = "other/kimi-k3"
    environment = _FakeEnvironment()

    with pytest.raises(ValueError, match="does not match profile model"):
        asyncio.run(
            agent.run(
                "offline fixture",
                cast(BaseEnvironment, environment),
                AgentContext(),
            )
        )

    assert environment.calls == []


def test_unknown_usage_stays_unknown_and_raw_errors_are_not_copied(
    tmp_path: Path,
) -> None:
    agent = _agent(tmp_path)
    agent.logs_dir.mkdir()
    (agent.logs_dir / "usage.json").write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "usageStatus": "MISSING",
                "usageCompleteness": "incomplete",
                "missingFields": [
                    "inputTokens",
                    "cacheCreationTokens",
                    "cacheReadTokens",
                    "outputTokens",
                    "costUsd",
                ],
                "termination": "SIGTERM",
                "observedTokenTotal": None,
                "normalizedUsage": {
                    "inputTokens": 0,
                    "cacheCreationTokens": 0,
                    "cacheReadTokens": 0,
                    "outputTokens": 0,
                    "costUsd": 0,
                },
            }
        ),
        encoding="utf-8",
    )
    (agent.logs_dir / "result.json").write_text(
        json.dumps(
            {
                "status": "valid-completed",
                "exitCode": 0,
                "error": "raw response-like diagnostic",
                "terminalError": {"message": "raw provider diagnostic"},
            }
        ),
        encoding="utf-8",
    )
    context = AgentContext(metadata={"task_id": "terminal-bench/fix-git"})

    agent.populate_context_post_run(context)

    assert context.n_input_tokens is None
    assert context.n_cache_tokens is None
    assert context.n_output_tokens is None
    assert context.cost_usd is None
    assert context.metadata == {
        "task_id": "terminal-bench/fix-git",
        "cindy_headless": {
            "status": "valid-completed",
            "exitCode": 0,
            "usageStatus": "MISSING",
            "usageCompleteness": "incomplete",
            "missingFields": [
                "cacheCreationTokens",
                "cacheReadTokens",
                "costUsd",
                "inputTokens",
                "outputTokens",
            ],
            "termination": "SIGTERM",
            "observedTokenTotal": None,
            "bundleMode": "formal",
        },
    }


def test_partial_usage_preserves_known_lower_bound_without_inventing_cost(
    tmp_path: Path,
) -> None:
    agent = _agent(tmp_path)
    agent.logs_dir.mkdir()
    (agent.logs_dir / "usage.json").write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "usageStatus": "PARTIAL",
                "usageCompleteness": "lower-bound",
                "missingFields": ["outputTokens", "costUsd"],
                "termination": "SIGTERM",
                "observedTokenTotal": 15,
                "normalizedUsage": {
                    "inputTokens": 10,
                    "cacheCreationTokens": 0,
                    "cacheReadTokens": 5,
                    "outputTokens": 0,
                    "costUsd": 0.1,
                },
            }
        ),
        encoding="utf-8",
    )
    (agent.logs_dir / "result.json").write_text(
        json.dumps({"status": "infra-terminated-signal"}),
        encoding="utf-8",
    )
    context = AgentContext()

    agent.populate_context_post_run(context)

    assert context.n_input_tokens == 15
    assert context.n_cache_tokens == 5
    assert context.n_output_tokens is None
    assert context.cost_usd is None  # costUsd is in missing_fields
    assert context.metadata == {
        "cindy_headless": {
            "status": "infra-terminated-signal",
            "usageStatus": "PARTIAL",
            "usageCompleteness": "lower-bound",
            "missingFields": ["costUsd", "outputTokens"],
            "termination": "SIGTERM",
            "observedTokenTotal": 15,
            "bundleMode": "formal",
        }
    }


def test_partial_usage_propagates_observed_cost(
    tmp_path: Path,
) -> None:
    """PARTIAL usage with cost NOT in missingFields should propagate the observed value."""
    agent = _agent(tmp_path)
    agent.logs_dir.mkdir()
    (agent.logs_dir / "usage.json").write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "usageStatus": "PARTIAL",
                "usageCompleteness": "lower-bound",
                "missingFields": [],
                "termination": None,
                "observedTokenTotal": None,
                "normalizedUsage": {
                    "inputTokens": 23398,
                    "cacheCreationTokens": 0,
                    "cacheReadTokens": 116992,
                    "outputTokens": 2032,
                    "costUsd": 0.228322,
                },
            }
        ),
        encoding="utf-8",
    )
    (agent.logs_dir / "result.json").write_text(
        json.dumps({"status": "valid-completed"}),
        encoding="utf-8",
    )
    context = AgentContext()

    agent.populate_context_post_run(context)

    assert context.n_input_tokens == 23398 + 0 + 116992
    assert context.n_cache_tokens == 116992
    assert context.n_output_tokens == 2032
    assert context.cost_usd == 0.228322


def test_complete_usage_propagates_all_fields(
    tmp_path: Path,
) -> None:
    """COMPLETE usage should propagate all token and cost fields."""
    agent = _agent(tmp_path)
    agent.logs_dir.mkdir()
    (agent.logs_dir / "usage.json").write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "usageStatus": "COMPLETE",
                "usageCompleteness": "exact",
                "missingFields": [],
                "termination": None,
                "observedTokenTotal": None,
                "normalizedUsage": {
                    "inputTokens": 500,
                    "cacheCreationTokens": 100,
                    "cacheReadTokens": 300,
                    "outputTokens": 200,
                    "costUsd": 0.05,
                },
            }
        ),
        encoding="utf-8",
    )
    (agent.logs_dir / "result.json").write_text(
        json.dumps({"status": "valid-completed"}),
        encoding="utf-8",
    )
    context = AgentContext()

    agent.populate_context_post_run(context)

    assert context.n_input_tokens == 500 + 100 + 300
    assert context.n_cache_tokens == 300
    assert context.n_output_tokens == 200
    assert context.cost_usd == 0.05
