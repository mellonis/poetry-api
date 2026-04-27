#!/usr/bin/env bash
#
# Smoke test for api.mellonis.ru (v1 — public endpoints only)
# Starts a managed server instance on port 3033.
# Usage: ./smoke-test-v1.sh
#

set -euo pipefail

PASS=0
FAIL=0
SMOKE_PORT=3033
BASE_URL="http://localhost:${SMOKE_PORT}"
LOG_FILE=$(mktemp)
SERVER_PID=""

red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -f "$LOG_FILE"
}
trap cleanup EXIT

check() {
    local label="$1" method="$2" path="$3" expected="$4"
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "${BASE_URL}${path}")

    if [ "$status" -eq "$expected" ]; then
        green "  PASS  $label (HTTP $status)"
        PASS=$((PASS + 1))
    else
        red "  FAIL  $label (expected $expected, got $status)"
        FAIL=$((FAIL + 1))
    fi
}

check_json_array() {
    local label="$1" path="$2"
    local response
    response=$(curl -s -w "\n%{http_code}" "${BASE_URL}${path}")
    local body status
    body=$(echo "$response" | sed '$d')
    status=$(echo "$response" | tail -1)

    if [ "$status" -ne 200 ]; then
        red "  FAIL  $label (expected 200, got $status)"
        FAIL=$((FAIL + 1))
        return
    fi

    if echo "$body" | grep -q '^\['; then
        green "  PASS  $label (HTTP 200, JSON array)"
        PASS=$((PASS + 1))
    else
        red "  FAIL  $label (response is not a JSON array)"
        FAIL=$((FAIL + 1))
    fi
}

# Extract first section ID from /sections response
get_first_section_id() {
    curl -s "${BASE_URL}/sections" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//'
}

# ---- Start managed server ----

bold ""
bold "Starting managed server on port ${SMOKE_PORT}..."

PORT=$SMOKE_PORT node --env-file=.env build/index.js > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Wait for server to be ready (up to 10 seconds)
for i in $(seq 1 20); do
    if curl -s -o /dev/null "http://localhost:${SMOKE_PORT}/sections" 2>/dev/null; then
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        red "Server exited unexpectedly. Log:"
        cat "$LOG_FILE"
        exit 1
    fi
    sleep 0.5
done

if ! curl -s -o /dev/null "http://localhost:${SMOKE_PORT}/sections" 2>/dev/null; then
    red "Server failed to start within 10 seconds. Log:"
    cat "$LOG_FILE"
    exit 1
fi

green "Server started (PID ${SERVER_PID})"

# ---- Tests ----

bold ""
bold "Smoke testing ${BASE_URL} (v1 — public endpoints)"
bold "============================================"

bold ""
bold "1. Sections"

check_json_array "GET /sections" "/sections"

SECTION_ID=$(get_first_section_id)

if [ -n "$SECTION_ID" ]; then
    check_json_array "GET /sections/${SECTION_ID}" "/sections/${SECTION_ID}"
else
    red "  SKIP  GET /sections/:id (no sections found)"
    FAIL=$((FAIL + 1))
fi

check "GET /sections/nonexistent" GET "/sections/nonexistent" 404

bold ""
bold "2. Things of the Day"

check_json_array "GET /things-of-the-day" "/things-of-the-day"

bold ""
bold "3. Search"

check "GET /search?q=test (no Meilisearch)" GET "/search?q=test" 503

bold ""
bold "4. Comments (public reads)"

check "GET /comments?scope=site" GET "/comments?scope=site" 200
check "GET /comments?thingId=1" GET "/comments?thingId=1" 200
check "GET /comments?thingId=1&scope=site (rejected)" GET "/comments?thingId=1&scope=site" 400

bold ""
bold "5. Swagger docs"

check "GET /docs" GET "/docs" 200

bold ""
bold "============================================"
if [ "$FAIL" -eq 0 ]; then
    green "All ${PASS} checks passed"
else
    echo "$(green "${PASS} passed"), $(red "${FAIL} failed")"
fi
bold "============================================"

exit "$FAIL"
