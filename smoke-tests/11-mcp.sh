# 11. MCP endpoint + personal access tokens
bold ""
bold "11. MCP"

if [ "${CMS_READY:-false}" != "true" ]; then
    red "  SKIP  MCP (no editor session from 10-cms)"
    return 0 2>/dev/null || true
fi

MCP_HEADERS=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')

# The SDK's legacy (2025-era) leg answers over one SSE frame
# ("event: message\ndata: {...}") regardless of era; the modern leg answers
# plain JSON. Accept either: take the last "data: " line if present,
# otherwise treat the whole body as JSON.
mcp_tools_count() {
    curl -s -X POST "${BASE_URL}/mcp" "${MCP_HEADERS[@]}" ${1:+-H "Authorization: Bearer $1"} \
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
        | python3 -c "
import json, sys
body = sys.stdin.read()
lines = [l for l in body.splitlines() if l.startswith('data: ')]
payload = lines[-1][len('data: '):] if lines else body
d = json.loads(payload)
print(len(d.get('result', {}).get('tools', [])))
" 2>/dev/null
}

if [ "$(mcp_tools_count)" = "5" ]; then
    green "  PASS  tools/list anonymous → 5 tools"
    PASS=$((PASS + 1))
else
    red "  FAIL  tools/list anonymous"
    FAIL=$((FAIL + 1))
fi

parse_response "$(request POST /auth/tokens '{"name":"smoke","scope":"editor"}' "$ACCESS_TOKEN")"
assert_status "POST /auth/tokens" 201 "$RESPONSE_STATUS"
PAT=$(json_field "token" "$RESPONSE_BODY")
PAT_ID=$(echo "$RESPONSE_BODY" | grep -o '"id":[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')

if [ "$(mcp_tools_count "$PAT")" = "29" ]; then
    green "  PASS  tools/list editor token → 29 tools"
    PASS=$((PASS + 1))
else
    red "  FAIL  tools/list editor token"
    FAIL=$((FAIL + 1))
fi

parse_response "$(request DELETE "/auth/tokens/${PAT_ID}" "" "$ACCESS_TOKEN")"
assert_status "DELETE /auth/tokens/:id" 204 "$RESPONSE_STATUS"

MCP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/mcp" "${MCP_HEADERS[@]}" -H "Authorization: Bearer $PAT" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
assert_status "revoked token → 401" 401 "$MCP_STATUS"
