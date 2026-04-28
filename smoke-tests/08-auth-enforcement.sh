# 8. Auth enforcement
bold ""
bold "8. Auth enforcement"

parse_response "$(request PATCH "/users/${USER_ID}/password" "{\"currentPassword\":\"x\",\"newPassword\":\"newpass123\"}")"
assert_status "PATCH /users/:userId/password (no auth)" 401 "$RESPONSE_STATUS"
