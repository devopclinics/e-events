"""Run the release-blocking deterministic routing evaluation."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
from app.main import _deterministic_route  # noqa: E402


dataset = Path(__file__).parents[1] / "evaluation" / "questions.jsonl"
rows = [json.loads(line) for line in dataset.read_text().splitlines() if line.strip()]
correct = sum(_deterministic_route(row["question"]) == row["route"] for row in rows)
sensitive = [row for row in rows if row["route"] == "sensitive"]
false_negatives = [row for row in sensitive if _deterministic_route(row["question"]) != "sensitive"]
print(json.dumps({"samples": len(rows), "accuracy": correct / len(rows), "sensitive_false_negatives": len(false_negatives)}, indent=2))
raise SystemExit(1 if false_negatives else 0)
