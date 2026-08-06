import argparse
import json
from pathlib import Path
from typing import List, Dict


def collect(job_dir: Path) -> List[Dict]:
    rows: List[Dict] = []
    for result_path in sorted(job_dir.glob("*/agent/result.json")):
        trial_dir = result_path.parent.parent
        result = json.loads(result_path.read_text(encoding="utf-8"))
        identity_path = result_path.parent / "identity.json"
        identity = json.loads(identity_path.read_text(encoding="utf-8")) if identity_path.is_file() else {}
        usage_path = result_path.parent / "usage.json"
        usage_artifact = json.loads(usage_path.read_text(encoding="utf-8")) if usage_path.is_file() else {}
        usage = usage_artifact.get("normalizedUsage", {})
        usage_status = usage_artifact.get("usageStatus", "MISSING")
        harbor_result_path = trial_dir / "result.json"
        harbor_result = json.loads(harbor_result_path.read_text(encoding="utf-8")) if harbor_result_path.is_file() else {}
        verifier_result = harbor_result.get("verifier_result") or {}
        rewards = verifier_result.get("rewards") or {}
        reward = rewards.get("reward")
        task_id = result.get("taskId") or identity.get("taskId")
        if not task_id or task_id == "unknown":
            task_id = trial_dir.name.split("__", 1)[0]
        result_class = result.get("resultClass")
        if reward is not None:
            result_class = "PASSED" if float(reward) == 1 else "FAILED_AGENT"
        rows.append({
            "variantId": identity.get("profileId") or identity.get("agentBackend") or "cindy-headless",
            "modelId": identity.get("actualModelId") or identity.get("requestedModelId") or "unknown",
            "taskId": task_id,
            "repetition": result.get("repetition") or identity.get("repetition") or 1,
            "reward": float(reward if reward is not None else result.get("reward") or 0),
            "resultClass": result_class or "FAILED_AGENT",
            "benchmark": result.get("benchmark") or identity.get("benchmark") or "harbor",
            "costUsd": usage.get("costUsd") if usage_status == "COMPLETE" else None,
            "inputTokens": usage.get("inputTokens") if usage_status != "MISSING" else None,
            "cacheTokens": usage.get("cacheReadTokens") if usage_status != "MISSING" else None,
            "outputTokens": usage.get("outputTokens") if usage_status != "MISSING" else None,
            "usageStatus": usage_status,
            "usageSource": usage_artifact.get("usageSource", []),
            "missingUsageFields": usage_artifact.get("missingFields", []),
            "termination": usage_artifact.get("termination"),
            "observedTokenTotal": usage_artifact.get("observedTokenTotal"),
            "durationMs": result.get("durationMs", 0),
            "upstreamProvider": identity.get("upstreamProvider"),
            "runId": result.get("runId") or identity.get("runId"),
            "cellId": result.get("cellId") or identity.get("cellId"),
            "attemptId": result.get("attemptId") or identity.get("attemptId"),
            "manifestDigest": result.get("manifestDigest") or identity.get("manifestDigest"),
            "trialDir": str(trial_dir),
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect normalized Cindy Headless Harbor results")
    parser.add_argument("job_dir", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    rows = collect(args.job_dir.resolve())
    args.output.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "trials": len(rows), "output": str(args.output.resolve())}))


if __name__ == "__main__":
    main()
