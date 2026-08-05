#!/usr/bin/env sh
set -eu
BACKEND=${1:-codex}
HARBOR_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_ROOT=$(CDPATH= cd -- "$HARBOR_DIR/../.." && pwd)
if [ -d "$SOURCE_ROOT/apps/cindy-headless" ]; then REPO_ROOT=$SOURCE_ROOT; else REPO_ROOT=$(CDPATH= cd -- "$HARBOR_DIR/.." && pwd); fi
RUN_ID="cindy-headless-harbor-smoke-$(date +%Y%m%d-%H%M%S)"
CONFIG=$(node "$HARBOR_DIR/generate-smoke-config.mjs" --backend "$BACKEND" --run-id "$RUN_ID" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).output')
export PYTHONPATH="$REPO_ROOT"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
harbor run --config "$CONFIG" --job-name "$RUN_ID" --yes --quiet
python "$HARBOR_DIR/collect_results.py" "$REPO_ROOT/.cindy-headless/jobs/$RUN_ID" "$REPO_ROOT/.cindy-headless/jobs/$RUN_ID/collected-results.json"
echo "PASS Harbor smoke: $REPO_ROOT/.cindy-headless/jobs/$RUN_ID"
