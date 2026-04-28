# 10d. CMS User Management (requires admin + canEditUsers)
bold ""
bold "10d. CMS User Management"

if [ "$CMS_READY" != "true" ]; then
    red "  SKIP  CMS users (CMS not ready)"
    return 0 2>/dev/null || true
fi

# Promote test user to admin group
if ! run_sql "UPDATE auth_user SET r_group_id = 1 WHERE login = '${TEST_LOGIN}'"; then
    red "  SKIP  CMS users (mysql client not available)"
    return 0 2>/dev/null || true
fi

# Re-login as admin
parse_response "$(request POST /auth/login "{\"login\":\"${TEST_LOGIN}\",\"password\":\"${TEST_PASSWORD}\"}")"
assert_status "POST /auth/login (as admin)" 200 "$RESPONSE_STATUS"

ACCESS_TOKEN=$(json_field "accessToken" "$RESPONSE_BODY")

if [ -z "$ACCESS_TOKEN" ]; then
    red "  SKIP  CMS users (no access token after admin promotion)"
    FAIL=$((FAIL + 6))
    return 0 2>/dev/null || true
fi

# List groups
parse_response "$(request GET /cms/groups "" "$ACCESS_TOKEN")"
assert_status "GET /cms/groups" 200 "$RESPONSE_STATUS"

# List users
parse_response "$(request GET /cms/users "" "$ACCESS_TOKEN")"
assert_status "GET /cms/users" 200 "$RESPONSE_STATUS"

# Create user
parse_response "$(request POST /cms/users "{\"login\":\"smkusr\",\"email\":\"smoke@test.test\",\"password\":\"pass123\",\"groupId\":3}" "$ACCESS_TOKEN")"
assert_status "POST /cms/users (create)" 201 "$RESPONSE_STATUS"
NEW_USER_ID=$(echo "$RESPONSE_BODY" | grep -o '"id":[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')

if [ -n "$NEW_USER_ID" ]; then
    # Get user
    parse_response "$(request GET "/cms/users/${NEW_USER_ID}" "" "$ACCESS_TOKEN")"
    assert_status "GET /cms/users/:userId" 200 "$RESPONSE_STATUS"

    # Update user
    parse_response "$(request PUT "/cms/users/${NEW_USER_ID}" "{\"groupId\":2}" "$ACCESS_TOKEN")"
    assert_status "PUT /cms/users/:userId (update)" 200 "$RESPONSE_STATUS"

    # Delete user
    parse_response "$(request DELETE "/cms/users/${NEW_USER_ID}" "" "$ACCESS_TOKEN")"
    assert_status "DELETE /cms/users/:userId" 204 "$RESPONSE_STATUS"
else
    red "  SKIP  CMS user CRUD (could not extract user ID)"
    FAIL=$((FAIL + 3))
fi

# Restore test user to editor group
run_sql "UPDATE auth_user SET r_group_id = 2 WHERE login = '${TEST_LOGIN}'" > /dev/null 2>&1

# Re-login as editor for subsequent tests
parse_response "$(request POST /auth/login "{\"login\":\"${TEST_LOGIN}\",\"password\":\"${TEST_PASSWORD}\"}")"
ACCESS_TOKEN=$(json_field "accessToken" "$RESPONSE_BODY")
REFRESH_TOKEN=$(json_field "refreshToken" "$RESPONSE_BODY")
