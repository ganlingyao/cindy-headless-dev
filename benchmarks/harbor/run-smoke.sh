#!/usr/bin/env sh
set -eu
BACKEND=${1:-codex}
HARBOR_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_ROOT=$(CDPATH= cd -- "$HARBOR_DIR/../.." && pwd)
if [ -d "$SOURCE_ROOT/apps/cindy-headless" ]; then REPO_ROOT=$SOURCE_ROOT; else REPO_ROOT=$(CDPATH= cd -- "$HARBOR_DIR/.." && pwd); fi
RUN_ID="cindy-headless-harbor-smoke-$(date +%Y%m%d-%H%M%S)"
CONFIG=$(node "$HARBOR_DIR/generate-smoke-config.mjs" --backend "$BACKEND" --run-id "$RUN_ID" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).output')
LOCAL_CONFIG=${CINDY_HEADLESS_CONFIG_FILE:-}
if [ -z "$LOCAL_CONFIG" ]; then
  for candidate in "$REPO_ROOT/apps/cindy-headless/config.local.json" "$REPO_ROOT/config.local.json" "$REPO_ROOT/.cindy-headless.json" "${XDG_CONFIG_HOME:-$HOME/.config}/cindy-headless/config.json"; do
    if [ -f "$candidate" ]; then LOCAL_CONFIG=$candidate; break; fi
  done
fi
if [ -n "$LOCAL_CONFIG" ] && { [ -z "${CINDY_HEADLESS_API_KEY:-}" ] || [ -z "${CINDY_HEADLESS_BASE_URL:-}" ]; }; then
  if [ -z "${CINDY_HEADLESS_API_KEY:-}" ]; then CINDY_HEADLESS_API_KEY=$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).gateway.apiKey' "$LOCAL_CONFIG"); export CINDY_HEADLESS_API_KEY; fi
  if [ -z "${CINDY_HEADLESS_BASE_URL:-}" ]; then CINDY_HEADLESS_BASE_URL=$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).gateway.baseUrl' "$LOCAL_CONFIG"); export CINDY_HEADLESS_BASE_URL; fi
fi
: "${CINDY_HEADLESS_API_KEY:?A gateway API key is required via config.local.json or environment variables}"
: "${CINDY_HEADLESS_BASE_URL:?A gateway base URL is required via config.local.json or environment variables}"
export PYTHONPATH="$REPO_ROOT"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
JOBS_DIR=$(sed -n 's/^[[:space:]]*jobs_dir:[[:space:]]*["'"']\{0,1\}\([^"'"']*\)["'"']\{0,1\}[[:space:]]*$/\1/p' "$CONFIG" | head -n 1)
[ -n "$JOBS_DIR" ] || { echo "Harbor config does not define jobs_dir: $CONFIG" >&2; exit 1; }
harbor run --config "$CONFIG" --job-name "$RUN_ID" --yes --quiet
python "$HARBOR_DIR/collect_results.py" "$JOBS_DIR/$RUN_ID" "$JOBS_DIR/$RUN_ID/collected-results.json"
echo "PASS Harbor smoke: $JOBS_DIR/$RUN_ID"
