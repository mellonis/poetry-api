# 13. Cleanup — delete the test user
bold ""
bold "13. Cleanup"

parse_response "$(request POST /auth/login "{\"login\":\"${TEST_LOGIN}\",\"password\":\"${TEST_PASSWORD}\"}")"
if [ "$RESPONSE_STATUS" -eq 200 ]; then
    ACCESS_TOKEN=$(json_field "accessToken" "$RESPONSE_BODY")
    USER_ID=$(echo "$RESPONSE_BODY" | grep -o '"id":[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')

    parse_response "$(request DELETE "/users/${USER_ID}" "{\"password\":\"${TEST_PASSWORD}\"}" "$ACCESS_TOKEN")"
    assert_status "DELETE /users/:userId (self-delete)" 204 "$RESPONSE_STATUS"

    parse_response "$(request POST /auth/login "{\"login\":\"${TEST_LOGIN}\",\"password\":\"${TEST_PASSWORD}\"}")"
    assert_status "POST /auth/login (after delete)" 401 "$RESPONSE_STATUS"
else
    red "  SKIP  Cleanup (could not login)"
    FAIL=$((FAIL + 2))
fi
