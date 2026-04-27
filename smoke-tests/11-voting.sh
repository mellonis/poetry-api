# 11. Voting
bold ""
bold "11. Voting"

if [ -n "$ACCESS_TOKEN" ]; then
    parse_response "$(request PUT /things/1/vote "{\"vote\":\"like\"}" "$ACCESS_TOKEN")"
    assert_status "PUT /things/1/vote (like)" 200 "$RESPONSE_STATUS"

    parse_response "$(request PUT /things/1/vote "{\"vote\":\"dislike\"}" "$ACCESS_TOKEN")"
    assert_status "PUT /things/1/vote (dislike)" 200 "$RESPONSE_STATUS"

    parse_response "$(request PUT /things/1/vote "{\"vote\":null}" "$ACCESS_TOKEN")"
    assert_status "PUT /things/1/vote (remove)" 200 "$RESPONSE_STATUS"
else
    red "  SKIP  Voting (no access token)"
    FAIL=$((FAIL + 3))
fi
