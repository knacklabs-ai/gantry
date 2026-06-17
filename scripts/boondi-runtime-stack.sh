#!/usr/bin/env bash
# Start the local Gantry runtime plumbing smoke stack.
# TEST ONLY: dry-run outbound is enabled and messages are scoped to test phones.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${GANTRY_ENV_FILE:-$HOME/gantry/.env}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

GANTRY_DEV_LOG="${GANTRY_DEV_LOG:-/tmp/gantry-dev.log}"
SMOKE_ENV_FILE="${GANTRY_RUNTIME_SMOKE_ENV:-/tmp/gantry-runtime-smoke.env}"
SHOPIFY_DEV_LOG="${SHOPIFY_DEV_LOG:-/tmp/mcp-shopify-dev.log}"
CRM_DEV_LOG="${CRM_DEV_LOG:-/tmp/mcp-crm-dev.log}"
GANTRY_CONTROL_PORT="${GANTRY_CONTROL_PORT:-4710}"
SHOPIFY_PORT="${SHOPIFY_PORT:-8081}"
CRM_PORT="${CRM_PORT:-8082}"
CORE_URL="${CORE_URL:-http://127.0.0.1:4710/}"
SHOPIFY_HEALTH_URL="${SHOPIFY_HEALTH_URL:-http://127.0.0.1:8081/healthz}"
CRM_HEALTH_URL="${CRM_HEALTH_URL:-http://127.0.0.1:8082/healthz}"
CALLER_IDENTITY_PHONE="${GANTRY_TEST_CALLER_IDENTITY_PHONE:-918097288633}"
CRM_RECONCILE_INTERVAL_MS="${BOONDI_CRM_RECONCILE_INTERVAL_MS:-10000}"
STOP_EXISTING="${STOP_EXISTING:-1}"

CORE_PID=""
SHOPIFY_PID=""
CRM_PID=""

OPERATOR=$(node -e "import('$ROOT/scripts/lib/phones.mjs').then(m=>process.stdout.write(m.OPERATOR_LIST))") || {
  echo "could not read OPERATOR_LIST from scripts/lib/phones.mjs"
  exit 1
}
SMOKE_CONTROL_TOKEN=$(node -e "import('node:crypto').then(({randomBytes})=>process.stdout.write(randomBytes(24).toString('base64url')))") || {
  echo "could not generate local smoke control token"
  exit 1
}
CONTROL_API_KEYS_JSON=$(
  SMOKE_CONTROL_TOKEN="$SMOKE_CONTROL_TOKEN" node -e "const token=process.env.SMOKE_CONTROL_TOKEN; process.stdout.write(JSON.stringify([{kid:'runtime-smoke',token,appId:'default',scopes:['sessions:read']}]))"
) || {
  echo "could not build local smoke control key JSON"
  exit 1
}
printf 'GANTRY_CONTROL_PORT=%s\nGANTRY_DEV_LOG=%s\nGANTRY_SMOKE_CONTROL_TOKEN=%s\n' \
  "$GANTRY_CONTROL_PORT" \
  "$GANTRY_DEV_LOG" \
  "$SMOKE_CONTROL_TOKEN" >"$SMOKE_ENV_FILE"
chmod 600 "$SMOKE_ENV_FILE"

cleanup() {
  trap - INT TERM EXIT
  kill "$CORE_PID" "$SHOPIFY_PID" "$CRM_PID" 2>/dev/null || true
  wait "$CORE_PID" "$SHOPIFY_PID" "$CRM_PID" 2>/dev/null || true
  rm -f "$SMOKE_ENV_FILE"
}
trap cleanup INT TERM EXIT

if [ "$STOP_EXISTING" = "1" ]; then
  pkill -f "apps/core/src/index.ts" 2>/dev/null || true
  pkill -f "packages/mcp-shopify/src/index.ts" 2>/dev/null || true
  pkill -f "packages/mcp-crm/src/index.ts" 2>/dev/null || true
  sleep 1
fi

rm -f "$GANTRY_DEV_LOG" "$SHOPIFY_DEV_LOG" "$CRM_DEV_LOG"

echo "starting shopify-api MCP (:${SHOPIFY_PORT}) -> $SHOPIFY_DEV_LOG"
(
  cd "$ROOT"
  exec env \
    -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_AUTH_TOKEN \
    -u ANTHROPIC_BASE_URL \
    -u CLAUDE_CODE_OAUTH_TOKEN \
    -u OPENAI_API_KEY \
    node --enable-source-maps --import tsx "$ROOT/packages/mcp-shopify/src/index.ts"
) >"$SHOPIFY_DEV_LOG" 2>&1 &
SHOPIFY_PID=$!

echo "starting boondi-crm MCP (:${CRM_PORT}) -> $CRM_DEV_LOG"
(
  cd "$ROOT"
  exec env \
    -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_AUTH_TOKEN \
    -u ANTHROPIC_BASE_URL \
    -u CLAUDE_CODE_OAUTH_TOKEN \
    -u OPENAI_API_KEY \
    BOONDI_CRM_RECONCILE_INTERVAL_MS="$CRM_RECONCILE_INTERVAL_MS" \
    node --enable-source-maps --import tsx "$ROOT/packages/mcp-crm/src/index.ts"
) >"$CRM_DEV_LOG" 2>&1 &
CRM_PID=$!

echo "starting Gantry core (:${GANTRY_CONTROL_PORT}) -> $GANTRY_DEV_LOG"
(
  cd "$ROOT"
  exec env \
    -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_AUTH_TOKEN \
    -u ANTHROPIC_BASE_URL \
    -u CLAUDE_CODE_OAUTH_TOKEN \
    -u OPENAI_API_KEY \
    GANTRY_FLOW_LOG=1 \
    GANTRY_OUTBOUND_DRYRUN=1 \
    GANTRY_CONTROL_API_KEYS_JSON="$CONTROL_API_KEYS_JSON" \
    GANTRY_TEST_OPERATOR_PHONE="$OPERATOR" \
    GANTRY_TEST_CALLER_IDENTITY_PHONE="$CALLER_IDENTITY_PHONE" \
    node --enable-source-maps --import tsx "$ROOT/apps/core/src/index.ts"
) >"$GANTRY_DEV_LOG" 2>&1 &
CORE_PID=$!

echo "waiting for health..."
for _ in $(seq 1 60); do
  sleep 1
  shopify=$(curl -s --max-time 3 "$SHOPIFY_HEALTH_URL" 2>/dev/null || true)
  crm=$(curl -s --max-time 3 "$CRM_HEALTH_URL" 2>/dev/null || true)
  core=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$CORE_URL" 2>/dev/null || true)

  if echo "$shopify" | grep -q '"ok":true' &&
    echo "$crm" | grep -q '"ok":true' &&
    [ -n "$core" ] &&
    [ "$core" != "000" ]; then
    echo "READY core=$core shopify=ok crm=ok"
    echo "Logs: core=$GANTRY_DEV_LOG shopify=$SHOPIFY_DEV_LOG crm=$CRM_DEV_LOG"
    echo "Next: GANTRY_RUNTIME_SMOKE_ENV=$SMOKE_ENV_FILE npm run smoke:boondi-runtime"
    wait "$CORE_PID" "$SHOPIFY_PID" "$CRM_PID"
    exit $?
  fi
done

echo "stack did not become healthy"
echo "Logs: core=$GANTRY_DEV_LOG shopify=$SHOPIFY_DEV_LOG crm=$CRM_DEV_LOG"
exit 1
