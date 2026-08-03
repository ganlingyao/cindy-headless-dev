import json
from pathlib import Path
from typing import override

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class CindyHeadlessAgent(BaseAgent):
    """Harbor 0.20 adapter for a prebuilt Cindy Headless Linux bundle."""

    SUPPORTS_ATIF = False
    SUPPORTS_RESUME = False
    SUPPORTS_WINDOWS = False

    def __init__(
        self,
        logs_dir: Path,
        bundle_dir: str,
        profile_path: str,
        codex_home_dir: str | None = None,
        version: str = "0.1.0",
        benchmark: str | None = None,
        benchmark_revision: str | None = None,
        run_id: str | None = None,
        manifest_digest: str | None = None,
        infra_retries: int = 1,
        max_cost_usd: float | None = None,
        stop_after_failures: int | None = None,
        *args,
        **kwargs,
    ):
        super().__init__(logs_dir, *args, **kwargs)
        self.bundle_dir = Path(bundle_dir).resolve()
        self.profile_path = Path(profile_path).resolve()
        self.codex_home_dir = Path(codex_home_dir).resolve() if codex_home_dir else None
        self._version = version
        self.benchmark = benchmark or self.extra_env.get("CINDY_BENCHMARK")
        self.benchmark_revision = benchmark_revision or self.extra_env.get("CINDY_BENCHMARK_REVISION")
        self.run_id = run_id or self.extra_env.get("CINDY_RUN_ID")
        self.manifest_digest = manifest_digest or self.extra_env.get("CINDY_MANIFEST_DIGEST")
        self.infra_retries = max(0, min(int(infra_retries), 1))
        self.max_cost_usd = max_cost_usd
        self.stop_after_failures = stop_after_failures
        self._batch_cost_usd = 0.0
        self._batch_failures = 0
        if not self.bundle_dir.is_dir():
            raise ValueError(f"bundle_dir does not exist: {self.bundle_dir}")
        if not self.profile_path.is_file():
            raise ValueError(f"profile_path does not exist: {self.profile_path}")
        if self.codex_home_dir is not None and not self.codex_home_dir.is_dir():
            raise ValueError(f"codex_home_dir does not exist: {self.codex_home_dir}")

    @staticmethod
    @override
    def name() -> str:
        return "cindy-headless"

    @override
    def version(self) -> str:
        return self._version

    @override
    async def setup(self, environment: BaseEnvironment) -> None:
        await environment.upload_dir(self.bundle_dir, "/opt/cindy-headless")
        await environment.upload_dir(self.profile_path.parent, "/opt/cindy-headless/profile")
        container_profile = f"/opt/cindy-headless/profile/{self.profile_path.name}"
        profile = json.loads(self.profile_path.read_text(encoding="utf-8"))
        backend = profile.get("agentBackend", "claude-code")
        binary = "codex" if backend == "codex" else "claude"
        runtime_env = dict(self.extra_env)
        if backend == "codex":
            if self.codex_home_dir is None:
                raise ValueError("codex profiles require an explicit codex_home_dir")
            await environment.upload_dir(self.codex_home_dir, "/opt/cindy-headless/codex-home")
            runtime_env["CINDY_HEADLESS_CODEX_HOME"] = "/opt/cindy-headless/codex-home"
        result = await environment.exec(
            f"set -e; chmod +x /opt/cindy-headless/bin/{binary}; "
            "node /opt/cindy-headless/dist/cli.cjs doctor "
            f"--profile {container_profile} --output-dir /logs/agent",
            env=runtime_env,
            timeout_sec=60,
        )
        if result.return_code != 0:
            raise RuntimeError(f"cindy-headless doctor failed: {result.stderr or result.stdout}")

    @override
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        requested = self.model_name.split("/", 1)[-1] if self.model_name else None
        profile = json.loads(self.profile_path.read_text(encoding="utf-8"))
        configured = profile.get("model", {}).get("requestedId")
        if requested and requested != configured:
            raise ValueError(
                f"Harbor model {requested!r} does not match profile model {configured!r}"
            )
        if self.max_cost_usd is not None and self._batch_cost_usd >= self.max_cost_usd:
            raise RuntimeError("CINDY_EVAL_STOP_COST_LIMIT")
        if self.stop_after_failures is not None and self._batch_failures >= self.stop_after_failures:
            raise RuntimeError("CINDY_EVAL_STOP_FAILURE_LIMIT")
        trial_name = self.logs_dir.parent.name
        task_id = self.extra_env.get("CINDY_TASK_ID") or (context.metadata.get("task_id") if context.metadata else None) or trial_name.split("__", 1)[0]
        base_env = {
            **self.extra_env,
            "CINDY_HEADLESS_TASK": instruction,
            "CINDY_BENCHMARK": self.benchmark or "harbor",
            "CINDY_BENCHMARK_REVISION": self.benchmark_revision or "unknown",
            "CINDY_RUN_ID": self.run_id or "harbor-run",
            "CINDY_MANIFEST_DIGEST": self.manifest_digest or "",
            "CINDY_TASK_ID": task_id or "unknown",
            "CINDY_REPETITION": self.extra_env.get("CINDY_REPETITION", "1"),
            "HARBOR_VERSION": "0.20.0",
        }
        if profile.get("agentBackend") == "codex":
            base_env["CINDY_HEADLESS_CODEX_HOME"] = "/opt/cindy-headless/codex-home"
        container_profile = f"/opt/cindy-headless/profile/{self.profile_path.name}"
        last_error = ""
        for attempt in range(1, self.infra_retries + 2):
            attempt_dir = f"/logs/agent/attempt-{attempt}"
            env = {**base_env, "CINDY_ATTEMPT_ID": f"{base_env['CINDY_TASK_ID']}-attempt-{attempt}", "CINDY_RETRY_COUNT": str(attempt - 1)}
            if attempt > 1:
                env["CINDY_REPLACES_ATTEMPT_ID"] = f"{base_env['CINDY_TASK_ID']}-attempt-1"
            result = await environment.exec(
                "mkdir -p " + attempt_dir + "; node /opt/cindy-headless/dist/cli.cjs run "
                f"--profile {container_profile} --working-dir /app --output-dir {attempt_dir}",
                env=env,
            )
            last_error = result.stderr or result.stdout
            artifact = await environment.exec(f"test -f {attempt_dir}/result.json && cat {attempt_dir}/result.json || true")
            try:
                result_class = json.loads(artifact.stdout).get("resultClass")
            except (ValueError, TypeError):
                result_class = "ERRORED_INFRA" if result.return_code != 0 else "FAILED_AGENT"
            if result.return_code == 0 or result_class != "ERRORED_INFRA" or attempt > self.infra_retries:
                await environment.exec(f"cp -f {attempt_dir}/* /logs/agent/ 2>/dev/null || true")
                break
        if result.return_code != 0:
            self._batch_failures += 1
            raise RuntimeError(f"cindy-headless failed: {last_error}")

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        usage_path = self.logs_dir / "usage.json"
        result_path = self.logs_dir / "result.json"
        if usage_path.is_file():
            usage_artifact = json.loads(usage_path.read_text(encoding="utf-8"))
            if usage_artifact.get("schemaVersion") != 1:
                raise ValueError("unsupported cindy-headless usage schema")
            usage = usage_artifact["normalizedUsage"]
            context.cost_usd = usage.get("costUsd")
            context.n_input_tokens = usage.get("inputTokens", 0) + usage.get("cacheCreationTokens", 0) + usage.get("cacheReadTokens", 0)
            context.n_cache_tokens = usage.get("cacheReadTokens", 0)
            context.n_output_tokens = usage.get("outputTokens", 0)
        if result_path.is_file():
            result = json.loads(result_path.read_text(encoding="utf-8"))
            context.metadata = {"cindy_headless": result}
            usage = json.loads(usage_path.read_text(encoding="utf-8")).get("normalizedUsage", {}) if usage_path.is_file() else {}
            self._batch_cost_usd += float(usage.get("costUsd") or 0)
