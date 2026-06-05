#!/usr/bin/env bash
# Bring up a CONTROLLED Gantry dev runtime + boondi-crm + Shopify MCP + dashboard for
# capture testing. Idempotent and safe to re-run every loop round (prompt edits sync at
# boot, so each round restarts Gantry).
#
# Invariants this enforces (verified against code, see the plan's "Verified runtime facts"):
#   * DRYRUN=1            — hard no-send switch (channel-wiring returns before storeMessage).
#   * identity override UNSET (empty) — record keyed to the SENDER persona, so chat+record
#     line up by phone (applyTestCallerIdentityOverride no-ops on empty).
#   * operator set = all 12 personas — enables /new per lane; belt-and-suspenders no-send.
#   * reconciler OFF on the CONNECTOR — agent-path isolation (Phase 4 re-enables separately).
#   * injected ANTHROPIC_*/OAuth stripped — the agent uses the machine's own Claude creds,
#     matching the live launchd env (which carries none).
#   * flow log on, text sink — flow fields land top-level for the harness parser.
# Inline env always wins over ~/gantry/.env (hydrateDynamicRuntimeEnv / dotenv-load both
# skip already-set keys), so this never mutates ~/gantry/.env.
set -euo pipefail

GANTRY_HOME="${GANTRY_HOME:-/Users/caw-d/gantry}"
REPO="/Users/caw-d/Desktop/gantry"
DASH_DIR="/Users/caw-d/Desktop/boondi-admin"
LOG="${GANTRY_DEV_LOG:-/tmp/gantry-capture.log}"
CRM_LOG="/tmp/boondi-crm.log"
SHOP_LOG="/tmp/shopify-mcp.log"
DASH_LOG="/tmp/boondi-admin.log"
STRIP=( -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN -u OPENAI_API_KEY )
OPERATOR="$(node -e "import('$REPO/scripts/lib/test-phones.mjs').then(m=>process.stdout.write(m.OPERATOR_LIST))")"
[ -n "$OPERATOR" ] || { echo "ERROR: empty operator set (test-phones.mjs failed to load)" >&2; exit 1; }

port_up() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
wait_up()   { local p="$1" n="${2:-60}"; for _ in $(seq 1 "$n"); do if port_up "$p"; then return 0; fi; sleep 1; done; return 1; }
wait_down() { local p="$1" n="${2:-15}"; for _ in $(seq 1 "$n"); do if ! port_up "$p"; then return 0; fi; sleep 1; done; return 1; }

# 1. Stop whatever owns :4710 — the KeepAlive launchd service AND any stray dev/dist run.
#    bootout is required: a plain kill respawns the service (KeepAlive).
echo "==> stopping any existing Gantry runtime"
launchctl bootout "gui/$(id -u)/com.gantry" 2>/dev/null || true
pkill -f "tsx apps/core/src/index.ts" 2>/dev/null || true
pkill -f "/dist/index.js" 2>/dev/null || true
# Reap orphaned agent child-runners (warm sessions) from a prior/wedged run so they
# don't linger; scoped to the Gantry-bundled SDK binary so nothing else is touched.
pkill -f "claude-agent-sdk-darwin-arm64/claude" 2>/dev/null || true
wait_down 4710 15 || { echo "ERROR: :4710 still held after stop attempt" >&2; exit 1; }
echo "    :4710 free"

# 2. boondi-crm on :8082 — restart FRESH with the reconciler OFF (deterministic isolation
#    for the agent-path loop; the heuristic reconciler needs no LLM).
echo "==> starting boondi-crm (:8082, reconciler OFF)"
# Kill the connector by PORT (its cmdline is just `tsx src/index.ts`, so a path
# pattern won't match) so the restart never hits EADDRINUSE on a survivor.
kill $(lsof -ti tcp:8082 2>/dev/null) 2>/dev/null || true
sleep 1
: > "$CRM_LOG"   # fresh log so the reconciler-OFF confirmation reflects THIS start
( cd "$REPO/packages/mcp-crm" && env "${STRIP[@]}" BOONDI_CRM_RECONCILE_ENABLED=false \
    node --env-file="$GANTRY_HOME/.env" --import tsx src/index.ts > "$CRM_LOG" 2>&1 & )
wait_up 8082 30 || { echo "ERROR: boondi-crm never came up; see $CRM_LOG" >&2; exit 1; }
sleep 1
if grep -q "boondi_crm_reconciler_disabled" "$CRM_LOG"; then
  echo "    reconciler OFF confirmed"
else
  echo "    WARN: did not see boondi_crm_reconciler_disabled in $CRM_LOG:" >&2
  grep -i "reconcil" "$CRM_LOG" | tail -3 >&2 || true
fi
curl -fsS http://127.0.0.1:8082/healthz >/dev/null 2>&1 && echo "    healthz ok" || echo "    WARN: healthz not ok"

# 3. Shopify MCP on :8081 (the order-support negative-control lane talks to it). Start if down.
if ! port_up 8081; then
  echo "==> starting Shopify MCP (:8081)"
  ( cd "$REPO" && env "${STRIP[@]}" \
      node --env-file="$GANTRY_HOME/.env" --import tsx packages/mcp-shopify/src/index.ts > "$SHOP_LOG" 2>&1 & )
  wait_up 8081 30 || true
fi
port_up 8081 && echo "    shopify-mcp up (:8081)" || echo "    WARN: shopify-mcp not up (order-support lane may get a hiccup reply); see $SHOP_LOG"

# 4. Dashboard on :3000 — the inspection surface. Start if down.
if ! port_up 3000; then
  echo "==> starting boondi-admin dashboard (:3000)"
  ( cd "$DASH_DIR" && env "${STRIP[@]}" npm run dev > "$DASH_LOG" 2>&1 & )
  wait_up 3000 60 || true
fi
port_up 3000 && echo "    dashboard up (:3000)" || echo "    WARN: dashboard not up; see $DASH_LOG"

# 5. Gantry dev runtime with the controlled capture env (inline; never mutates ~/gantry/.env).
echo "==> starting Gantry dev runtime (:4710) — DRYRUN=1, identity override UNSET"
: > "$LOG"
( cd "$REPO" && env "${STRIP[@]}" \
    GANTRY_HOME="$GANTRY_HOME" \
    GANTRY_FLOW_LOG=1 LOG_FORMAT=text \
    GANTRY_OUTBOUND_DRYRUN=1 \
    GANTRY_TEST_OPERATOR_PHONE="$OPERATOR" \
    GANTRY_TEST_CALLER_IDENTITY_PHONE= \
    npm run dev > "$LOG" 2>&1 & )
wait_up 4710 90 || { echo "ERROR: gantry never came up; see $LOG" >&2; exit 1; }
echo "    gantry up (:4710)"

echo "preflight done. gantry_log=$LOG  crm_log=$CRM_LOG  operator=$OPERATOR"
