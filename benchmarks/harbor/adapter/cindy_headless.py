import hashlib
import json
import math
import re
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any, override

from harbor import __version__ as harbor_version
from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.agent.name import AgentName


_SHA256_RE = re.compile(r"(?:sha256:)?([0-9a-f]{64})")
_NORMALIZED_RESULT_FIELDS = (
    "schemaVersion",
    "status",
    "exitCode",
    "resultClass",
    "reward",
    "runId",
    "cellId",
    "attemptId",
    "manifestDigest",
    "configDigest",
    "bundleManifestDigest",
    "cindyCommit",
    "benchmark",
    "benchmarkRevision",
    "taskId",
    "repetition",
    "sessionId",
    "turnsCount",
    "durationMs",
    "timedOut",
    "timeoutMs",
    "timeoutReachedAtMs",
    "eventsCount",
    "responseArtifact",
    "retries",
    "replacesAttemptId",
)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _normalize_sha256(value: str | None, *, label: str) -> str:
    match = _SHA256_RE.fullmatch(value or "")
    if match is None:
        raise ValueError(f"{label} must be a frozen SHA-256 digest")
    return f"sha256:{match.group(1)}"


def _verify_manifest_file_digest(
    path: Path,
    manifest: dict[str, Any],
    field: str,
) -> str:
    expected = _normalize_sha256(
        manifest.get(field) if isinstance(manifest.get(field), str) else None,
        label=f"bundle manifest {field}",
    )
    if _sha256_file(path) != expected:
        raise ValueError(f"bundle {field} mismatch")
    return expected.removeprefix("sha256:")


def _model_matches(harbor_model: str | None, configured_model: str | None) -> bool:
    if not harbor_model or not configured_model:
        return False
    if "/" in configured_model:
        return harbor_model == configured_model
    return (
        harbor_model == configured_model
        or harbor_model.rsplit("/", 1)[-1] == configured_model
    )


def _optional_non_negative_int(value: object, *, label: str) -> int | None:
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer or null")
    return value


def _optional_non_negative_float(value: object, *, label: str) -> float | None:
    if value is None:
        return None
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value < 0
    ):
        raise ValueError(f"{label} must be a finite non-negative number or null")
    return float(value)


@dataclass(frozen=True)
class _FrozenInputs:
    bundle_dir: Path
    profile_path: Path
    bundle_manifest_sha256: str
    profile_sha256: str
    bundle_manifest: dict[str, Any]
    profile: dict[str, Any]
    cindy_commit: str
    bundle_mode: str
    bundle_prompt_name: str
    system_prompt_digest: str | None


def _load_frozen_inputs(
    *,
    bundle_dir: str,
    profile_path: str,
    bundle_manifest_sha256: str,
    profile_sha256: str,
    version: str,
    development_bundle: bool,
) -> _FrozenInputs:
    resolved_bundle = Path(bundle_dir).resolve()
    resolved_profile = Path(profile_path).resolve()
    frozen_bundle_digest = _normalize_sha256(
        bundle_manifest_sha256,
        label="bundle_manifest_sha256",
    )
    frozen_profile_digest = _normalize_sha256(
        profile_sha256,
        label="profile_sha256",
    )
    if not resolved_bundle.is_dir():
        raise ValueError(f"bundle_dir does not exist: {resolved_bundle}")
    if not resolved_profile.is_file():
        raise ValueError(f"profile_path does not exist: {resolved_profile}")

    manifest_path = resolved_bundle / "bundle-manifest.json"
    if not manifest_path.is_file():
        raise ValueError(f"incomplete cindy-headless bundle: {manifest_path}")
    if _sha256_file(manifest_path) != frozen_bundle_digest:
        raise ValueError("bundle manifest digest mismatch")
    if _sha256_file(resolved_profile) != frozen_profile_digest:
        raise ValueError("profile digest mismatch")

    bundle_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(bundle_manifest, dict):
        raise ValueError("bundle manifest must be a JSON object")
    if (
        bundle_manifest.get("schemaVersion") != 4
        or bundle_manifest.get("headlessContractVersion") != 1
    ):
        raise ValueError("unsupported cindy-headless bundle contract")
    if bundle_manifest.get("cindyHeadlessVersion") != version:
        raise ValueError("bundle cindy-headless version does not match Adapter version")
    bundle_mode = bundle_manifest.get("bundleMode", "formal")
    if development_bundle:
        if bundle_mode != "development":
            raise ValueError("development_bundle requires a development bundle")
    elif bundle_mode == "development":
        raise ValueError("development bundles require explicit development_bundle=true")
    cindy_commit = bundle_manifest.get("cindyCommit")
    if (
        not isinstance(cindy_commit, str)
        or re.fullmatch(r"[0-9a-f]{40}", cindy_commit) is None
    ):
        raise ValueError("bundle cindyCommit must be a full Git commit")

    profile = json.loads(resolved_profile.read_text(encoding="utf-8"))
    if not isinstance(profile, dict):
        raise ValueError("profile must be a JSON object")
    if profile.get("version") != 1:
        raise ValueError("formal Cindy profiles require profile version 1")
    if profile.get("containerSandbox") is not True:
        raise ValueError("formal Cindy profiles require containerSandbox=true")
    model = profile.get("model")
    configured_model = model.get("requestedId") if isinstance(model, dict) else None
    supported_models = profile.get("supportedModelIds")
    if (
        not isinstance(supported_models, list)
        or configured_model not in supported_models
    ):
        raise ValueError("profile must declare its exact requested model as supported")
    backend = profile.get("agentBackend")
    if backend not in {"claude-code", "codex"}:
        raise ValueError("unsupported profile agentBackend")
    profile_prompt_file = profile.get("systemPromptFile")
    changed_dimensions = profile.get("changedDimensions")
    prompt_disabled_by_experiment = (
        profile_prompt_file is None
        and isinstance(changed_dimensions, list)
        and "systemPrompt" in changed_dimensions
    )
    if profile_prompt_file != "prompt.md" and not prompt_disabled_by_experiment:
        raise ValueError(
            "formal Cindy profiles must use systemPromptFile prompt.md; "
            "derived profiles may omit it only with changedDimensions "
            "containing systemPrompt"
        )
    if development_bundle and (
        backend != "claude-code" or bundle_manifest.get("agentBackend") != "claude-code"
    ):
        raise ValueError("development bundles currently support Claude Code only")
    binary = "codex" if backend == "codex" else "claude"
    if profile.get("agentBinaryPath") != f"/opt/cindy-headless/bin/{binary}":
        raise ValueError("formal Cindy profile Agent path must use the frozen bundle")
    version_field = "codexVersion" if backend == "codex" else "claudeCodeVersion"
    if profile.get("agentBinaryVersion") != bundle_manifest.get(version_field):
        raise ValueError("profile Agent binary version does not match bundle manifest")

    bundle_prompt_name = "codex-prompt.md" if backend == "codex" else "prompt.md"
    prompt_digest_field = (
        "codexSystemPromptDigest" if backend == "codex" else "systemPromptDigest"
    )
    bundle_system_prompt_digest = _normalize_sha256(
        bundle_manifest.get(prompt_digest_field)
        if isinstance(bundle_manifest.get(prompt_digest_field), str)
        else None,
        label=f"bundle manifest {prompt_digest_field}",
    ).removeprefix("sha256:")
    system_prompt_digest = (
        bundle_system_prompt_digest if profile_prompt_file == "prompt.md" else None
    )
    required_members = (
        (
            ("dist/cli.cjs", "cliDigest"),
            ("prompt.md", "systemPromptDigest"),
            ("bin/claude", "claudeBinaryDigest"),
        )
        if development_bundle
        else (
            ("dist/cli.cjs", "cliDigest"),
            ("prompt.md", "systemPromptDigest"),
            ("codex-prompt.md", "codexSystemPromptDigest"),
            ("bin/claude", "claudeBinaryDigest"),
            ("bin/codex", "codexBinaryDigest"),
            ("bin/node", "nodeBinaryDigest"),
        )
    )
    if development_bundle:
        required_members = (*required_members, ("bin/node", "nodeBinaryDigest"))
    missing = [
        str(resolved_bundle / relative_path)
        for relative_path, _ in required_members
        if not (resolved_bundle / relative_path).is_file()
    ]
    if missing:
        raise ValueError(f"incomplete cindy-headless bundle: {', '.join(missing)}")
    for relative_path, digest_field in required_members:
        _verify_manifest_file_digest(
            resolved_bundle / relative_path,
            bundle_manifest,
            digest_field,
        )
    return _FrozenInputs(
        bundle_dir=resolved_bundle,
        profile_path=resolved_profile,
        bundle_manifest_sha256=frozen_bundle_digest,
        profile_sha256=frozen_profile_digest,
        bundle_manifest=bundle_manifest,
        profile=profile,
        cindy_commit=cindy_commit,
        bundle_mode=bundle_mode,
        bundle_prompt_name=bundle_prompt_name,
        system_prompt_digest=system_prompt_digest,
    )


class CindyHeadlessAgent(BaseAgent):
    """Run a verified Cindy Headless Linux bundle as a Harbor Agent."""

    SUPPORTS_ATIF = False
    SUPPORTS_RESUME = False
    SUPPORTS_WINDOWS = False

    def __init__(
        self,
        logs_dir: Path,
        bundle_dir: str,
        profile_path: str,
        bundle_manifest_sha256: str,
        profile_sha256: str,
        codex_home_dir: str | None = None,
        version: str = "0.1.0",
        development_bundle: bool = False,
        *args,
        **kwargs,
    ):
        super().__init__(logs_dir, *args, **kwargs)
        frozen = _load_frozen_inputs(
            bundle_dir=bundle_dir,
            profile_path=profile_path,
            bundle_manifest_sha256=bundle_manifest_sha256,
            profile_sha256=profile_sha256,
            version=version,
            development_bundle=development_bundle,
        )
        self.bundle_dir = frozen.bundle_dir
        self.profile_path = frozen.profile_path
        self.codex_home_dir = Path(codex_home_dir).resolve() if codex_home_dir else None
        self._version = version
        self.bundle_manifest_sha256 = frozen.bundle_manifest_sha256
        self.profile_sha256 = frozen.profile_sha256
        if self.codex_home_dir is not None and not self.codex_home_dir.is_dir():
            raise ValueError(f"codex_home_dir does not exist: {self.codex_home_dir}")
        self.bundle_manifest = frozen.bundle_manifest
        self.cindy_commit = frozen.cindy_commit
        self.bundle_mode = frozen.bundle_mode
        self.profile = frozen.profile
        self.bundle_prompt_name = frozen.bundle_prompt_name
        self.system_prompt_digest = frozen.system_prompt_digest
        self._working_dir: str | None = None

    async def _resolve_working_dir(self, environment: BaseEnvironment) -> str:
        result = await environment.exec("pwd")
        working_dir = (result.stdout or "").strip()
        if result.return_code != 0 or not working_dir.startswith("/"):
            detail = (result.stderr or result.stdout or "no command output").strip()
            raise RuntimeError(f"unable to resolve task working directory: {detail}")
        check = await environment.exec(
            f"test -d {shlex.quote(working_dir)} && test -w {shlex.quote(working_dir)}"
        )
        if check.return_code != 0:
            raise RuntimeError(
                f"task working directory is missing or not writable: {working_dir}"
            )
        self._working_dir = working_dir
        return working_dir

    @classmethod
    def validate_frozen_config(
        cls,
        *,
        bundle_dir: str,
        profile_path: str,
        bundle_manifest_sha256: str,
        profile_sha256: str,
        version: str = "0.1.0",
        development_bundle: bool = False,
        **_: object,
    ) -> dict[str, str | None]:
        frozen = _load_frozen_inputs(
            bundle_dir=bundle_dir,
            profile_path=profile_path,
            bundle_manifest_sha256=bundle_manifest_sha256,
            profile_sha256=profile_sha256,
            version=version,
            development_bundle=development_bundle,
        )
        model = frozen.profile["model"]
        if not isinstance(model, dict) or not isinstance(model.get("requestedId"), str):
            raise ValueError("profile model.requestedId must be a string")
        profile_id = frozen.profile.get("id")
        if not isinstance(profile_id, str) or not profile_id:
            raise ValueError("profile id must be a non-empty string")
        backend = frozen.profile.get("agentBackend")
        if not isinstance(backend, str):
            raise ValueError("profile agentBackend must be a string")
        return {
            "cindy_version": version,
            "cindy_commit": frozen.cindy_commit,
            "profile_id": profile_id,
            "requested_model": model["requestedId"],
            "agent_backend": backend,
            "system_prompt_digest": (
                f"sha256:{frozen.system_prompt_digest}"
                if frozen.system_prompt_digest is not None
                else None
            ),
            "bundle_manifest_digest": frozen.bundle_manifest_sha256,
            "profile_digest": frozen.profile_sha256,
        }

    @staticmethod
    @override
    def name() -> str:
        # Harbor 0.20 does not yet expose CINDY_PRODUCTION in AgentName. Keep
        # the vendored adapter importable through a custom import_path while
        # remaining identical in behavior once the Harbor integration patch
        # adds the enum member.
        member = getattr(AgentName, "CINDY_PRODUCTION", None)
        return member.value if member is not None else "cindy-production"

    @classmethod
    @override
    def supported_model_ids(
        cls,
        *,
        harness_version: str,
        provider: str,
        requested_model: str,
        endpoint_host: str,
    ) -> tuple[str, ...]:
        return (requested_model,)

    @override
    def version(self) -> str:
        return self._version

    @override
    async def setup(self, environment: BaseEnvironment) -> None:
        await environment.upload_dir(self.bundle_dir, "/opt/cindy-headless")
        await environment.upload_file(
            self.profile_path,
            "/opt/cindy-headless/profile.json",
        )
        backend = self.profile["agentBackend"]
        binary = "codex" if backend == "codex" else "claude"
        working_dir = await self._resolve_working_dir(environment)
        runtime_env = dict(self.extra_env)
        if self.system_prompt_digest is not None:
            runtime_env["CINDY_EXPECTED_SYSTEM_PROMPT_DIGEST"] = (
                self.system_prompt_digest
            )
        else:
            runtime_env.pop("CINDY_EXPECTED_SYSTEM_PROMPT_DIGEST", None)
        if backend == "codex":
            if self.codex_home_dir is not None:
                await environment.upload_dir(
                    self.codex_home_dir,
                    "/opt/cindy-headless/codex-home",
                )
                runtime_env["CINDY_HEADLESS_CODEX_HOME"] = (
                    "/opt/cindy-headless/codex-home"
                )
            elif not runtime_env.get("CINDY_HEADLESS_API_KEY"):
                raise ValueError(
                    "codex profiles require codex_home_dir or CINDY_HEADLESS_API_KEY"
                )
        prompt_setup = (
            "cp -f /opt/cindy-headless/codex-prompt.md /opt/cindy-headless/prompt.md; "
            if backend == "codex"
            else ""
        )
        result = await environment.exec(
            f"set -e; mkdir -p /logs/agent; {prompt_setup}"
            f"chmod +x /opt/cindy-headless/bin/node "
            f"/opt/cindy-headless/bin/{binary}; "
            "/opt/cindy-headless/bin/node "
            "/opt/cindy-headless/dist/cli.cjs doctor "
            "--profile /opt/cindy-headless/profile.json --output-dir /logs/agent "
            f"--working-dir {shlex.quote(working_dir)}",
            env=runtime_env,
            timeout_sec=60,
        )
        if result.return_code != 0:
            detail = (result.stderr or result.stdout or "no command output").strip()
            raise RuntimeError(
                f"cindy-headless doctor failed (exit {result.return_code}): "
                f"{detail[-4000:]}"
            )

    @override
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        configured = self.profile.get("model", {}).get("requestedId")
        if not _model_matches(self.model_name, configured):
            raise ValueError(
                f"Harbor model {self.model_name!r} does not match profile "
                f"model {configured!r}"
            )
        manifest_digest = _normalize_sha256(
            self.extra_env.get("CINDY_MANIFEST_DIGEST"),
            label="CINDY_MANIFEST_DIGEST",
        )
        runtime_env = {
            **self.extra_env,
            "CINDY_HEADLESS_TASK": instruction,
            "CINDY_MANIFEST_DIGEST": manifest_digest,
            "CINDY_BUNDLE_MANIFEST_DIGEST": self.bundle_manifest_sha256,
            "CINDY_COMMIT": self.cindy_commit,
            "HARBOR_VERSION": harbor_version,
        }
        if self.system_prompt_digest is not None:
            runtime_env["CINDY_EXPECTED_SYSTEM_PROMPT_DIGEST"] = (
                self.system_prompt_digest
            )
        else:
            runtime_env.pop("CINDY_EXPECTED_SYSTEM_PROMPT_DIGEST", None)
        if self.profile["agentBackend"] == "codex" and self.codex_home_dir is not None:
            runtime_env["CINDY_HEADLESS_CODEX_HOME"] = "/opt/cindy-headless/codex-home"
        working_dir = self._working_dir or await self._resolve_working_dir(environment)
        timeout_sec = context.execution_timeout_sec
        # Give Headless a short grace period to close the SDK stream and persist
        # usage/trace before Harbor enforces its outer deadline.
        headless_timeout_ms = (
            max(1_000, int((timeout_sec - 5) * 1_000))
            if timeout_sec is not None
            else None
        )
        timeout_arg = (
            f" --timeout-ms {headless_timeout_ms}"
            if headless_timeout_ms is not None
            else ""
        )
        result = await environment.exec(
            "mkdir -p /logs/agent; /opt/cindy-headless/bin/node "
            "/opt/cindy-headless/dist/cli.cjs run "
            "--profile /opt/cindy-headless/profile.json "
            f"--working-dir {shlex.quote(working_dir)} "
            f"--output-dir /logs/agent{timeout_arg}",
            env=runtime_env,
            timeout_sec=timeout_sec,
        )
        await environment.exec("rm -rf /logs/agent/state")
        if result.return_code != 0:
            raise RuntimeError(
                "cindy-headless exited nonzero; inspect the raw agent artifacts"
            )

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        usage_path = self.logs_dir / "usage.json"
        result_path = self.logs_dir / "result.json"
        usage_metadata: dict[str, object] = {}
        if usage_path.is_file():
            usage_artifact = json.loads(usage_path.read_text(encoding="utf-8"))
            if not isinstance(usage_artifact, dict):
                raise ValueError("cindy-headless usage artifact must be a JSON object")
            if usage_artifact.get("schemaVersion") != 2:
                raise ValueError("unsupported cindy-headless usage schema")
            usage = usage_artifact.get("normalizedUsage")
            if not isinstance(usage, dict):
                raise ValueError("normalizedUsage must be a JSON object")
            usage_status = usage_artifact.get("usageStatus")
            if usage_status not in {"COMPLETE", "PARTIAL", "MISSING"}:
                raise ValueError("unsupported cindy-headless usage status")
            missing_value = usage_artifact.get("missingFields")
            if not isinstance(missing_value, list) or not all(
                isinstance(field, str) for field in missing_value
            ):
                raise ValueError("usage missingFields must be a string array")
            missing_fields = set(missing_value)

            def known_int(field: str) -> int | None:
                if usage_status == "MISSING" or field in missing_fields:
                    return None
                return _optional_non_negative_int(
                    usage.get(field),
                    label=f"normalizedUsage.{field}",
                )

            context.cost_usd = (
                _optional_non_negative_float(
                    usage.get("costUsd"),
                    label="normalizedUsage.costUsd",
                )
                if usage_status != "MISSING" and "costUsd" not in missing_fields
                else None
            )
            input_parts = [
                known_int("inputTokens"),
                known_int("cacheCreationTokens"),
                known_int("cacheReadTokens"),
            ]
            context.n_input_tokens = (
                sum(value for value in input_parts if value is not None)
                if all(value is not None for value in input_parts)
                else None
            )
            context.n_cache_tokens = known_int("cacheReadTokens")
            context.n_output_tokens = known_int("outputTokens")
            usage_metadata = {
                "usageStatus": usage_status,
                "usageCompleteness": usage_artifact.get("usageCompleteness"),
                "missingFields": sorted(missing_fields),
                "termination": usage_artifact.get("termination"),
                "observedTokenTotal": usage_artifact.get("observedTokenTotal"),
            }
        if result_path.is_file():
            result = json.loads(result_path.read_text(encoding="utf-8"))
            if not isinstance(result, dict):
                raise ValueError("cindy-headless result artifact must be a JSON object")
            normalized_result = {
                field: result[field]
                for field in _NORMALIZED_RESULT_FIELDS
                if field in result
            }
            context.metadata = {
                **(context.metadata or {}),
                "cindy_headless": {
                    **normalized_result,
                    **usage_metadata,
                    "bundleMode": self.bundle_mode,
                },
            }
