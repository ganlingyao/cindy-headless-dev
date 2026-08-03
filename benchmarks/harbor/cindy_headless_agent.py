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
        *args,
        **kwargs,
    ):
        super().__init__(logs_dir, *args, **kwargs)
        self.bundle_dir = Path(bundle_dir).resolve()
        self.profile_path = Path(profile_path).resolve()
        self.codex_home_dir = Path(codex_home_dir).resolve() if codex_home_dir else None
        self._version = version
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
        env = {**self.extra_env, "CINDY_HEADLESS_TASK": instruction}
        if profile.get("agentBackend") == "codex":
            env["CINDY_HEADLESS_CODEX_HOME"] = "/opt/cindy-headless/codex-home"
        container_profile = f"/opt/cindy-headless/profile/{self.profile_path.name}"
        result = await environment.exec(
            "node /opt/cindy-headless/dist/cli.cjs run "
            f"--profile {container_profile} "
            "--working-dir /app --output-dir /logs/agent",
            env=env,
        )
        if result.return_code != 0:
            raise RuntimeError(f"cindy-headless failed: {result.stderr or result.stdout}")

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
