import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from collect_results import collect


class CollectResultsTest(unittest.TestCase):
    def test_missing_usage_is_not_reported_as_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "trial__abc" / "agent"
            root.mkdir(parents=True)
            (root / "identity.json").write_text(json.dumps({"profileId": "cindy", "taskId": "t"}), encoding="utf-8")
            (root / "result.json").write_text(json.dumps({"resultClass": "ERRORED_INFRA", "taskId": "t"}), encoding="utf-8")
            rows = collect(Path(directory))
            self.assertEqual(rows[0]["usageStatus"], "MISSING")
            self.assertIsNone(rows[0]["inputTokens"])
            self.assertIsNone(rows[0]["costUsd"])

    def test_partial_usage_keeps_observed_fields_and_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "trial__abc" / "agent"
            root.mkdir(parents=True)
            (root / "identity.json").write_text(json.dumps({"profileId": "cindy", "taskId": "t"}), encoding="utf-8")
            (root / "result.json").write_text(json.dumps({"resultClass": "FAILED_AGENT", "taskId": "t"}), encoding="utf-8")
            (root / "usage.json").write_text(json.dumps({"schemaVersion": 2, "usageStatus": "PARTIAL", "normalizedUsage": {"inputTokens": 12, "cacheReadTokens": 4, "outputTokens": 0}, "missingFields": ["costUsd"], "observedTokenTotal": 16}), encoding="utf-8")
            rows = collect(Path(directory))
            self.assertEqual(rows[0]["usageStatus"], "PARTIAL")
            self.assertEqual(rows[0]["inputTokens"], 12)
            self.assertIsNone(rows[0]["costUsd"])
            self.assertEqual(rows[0]["observedTokenTotal"], 16)


if __name__ == "__main__":
    unittest.main()
