# 10. CMS (requires editor role + canEditContent right)
bold ""
bold "10. CMS"

CMS_READY=false

# Parse DB connection from .env
DB_CONN=$(grep '^CONNECTION_STRING=' .env | sed 's/^CONNECTION_STRING=//')
DB_USER=$(echo "$DB_CONN" | sed 's|mysql://||;s|:.*||')
DB_PASS=$(echo "$DB_CONN" | sed 's|mysql://[^:]*:||;s|@.*||')
DB_HOST=$(echo "$DB_CONN" | sed 's|.*@||;s|:.*||')
DB_PORT=$(echo "$DB_CONN" | sed 's|.*:||;s|/.*||')
DB_NAME=$(echo "$DB_CONN" | sed 's|.*/||')

run_sql() {
    docker exec poetry-db mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "$1" 2>/dev/null \
        || mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" -P "$DB_PORT" "$DB_NAME" -e "$1" 2>/dev/null
}

# Promote test user to editor group
if ! run_sql "UPDATE auth_user SET r_group_id = 2 WHERE login = '${TEST_LOGIN}'"; then
    red "  SKIP  CMS (mysql client not available or DB connection failed)"
    return 0 2>/dev/null || true
fi

# Re-login to get updated JWT with editor role
parse_response "$(request POST /auth/login "{\"login\":\"${TEST_LOGIN}\",\"password\":\"${TEST_PASSWORD}\"}")"
assert_status "POST /auth/login (as editor)" 200 "$RESPONSE_STATUS"

ACCESS_TOKEN=$(json_field "accessToken" "$RESPONSE_BODY")
REFRESH_TOKEN=$(json_field "refreshToken" "$RESPONSE_BODY")

if [ -n "$ACCESS_TOKEN" ]; then
    # Read-only CMS endpoints (editor role sufficient)
    parse_response "$(request GET /cms/section-types "" "$ACCESS_TOKEN")"
    assert_status "GET /cms/section-types" 200 "$RESPONSE_STATUS"

    parse_response "$(request GET /cms/sections "" "$ACCESS_TOKEN")"
    assert_status "GET /cms/sections" 200 "$RESPONSE_STATUS"

    CMS_READY=true

    # Create section
    parse_response "$(request POST /cms/sections "{\"identifier\":\"smtst\",\"title\":\"Smoke Test\",\"typeId\":1}" "$ACCESS_TOKEN")"
    assert_status "POST /cms/sections (create)" 201 "$RESPONSE_STATUS"
    SECTION_DB_ID=$(echo "$RESPONSE_BODY" | grep -o '"id":[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')

    if [ -n "$SECTION_DB_ID" ]; then
        # Update section
        parse_response "$(request PUT "/cms/sections/${SECTION_DB_ID}" "{\"title\":\"Smoke Updated\",\"settings\":{\"showAll\":true,\"reverseOrder\":false}}" "$ACCESS_TOKEN")"
        assert_status "PUT /cms/sections/:sectionId (update)" 200 "$RESPONSE_STATUS"

        # List things (empty)
        parse_response "$(request GET "/cms/sections/${SECTION_DB_ID}/things" "" "$ACCESS_TOKEN")"
        assert_status "GET /cms/sections/:sectionId/things" 200 "$RESPONSE_STATUS"

        # Delete section (empty, should succeed)
        parse_response "$(request DELETE "/cms/sections/${SECTION_DB_ID}" "" "$ACCESS_TOKEN")"
        assert_status "DELETE /cms/sections/:sectionId" 204 "$RESPONSE_STATUS"
    else
        red "  SKIP  CMS section CRUD (could not extract section ID)"
        FAIL=$((FAIL + 3))
    fi
else
    red "  SKIP  CMS (no access token after editor promotion)"
    FAIL=$((FAIL + 7))
fi
