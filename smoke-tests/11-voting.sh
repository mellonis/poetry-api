# 11. Voting
bold ""
bold "11. Voting"

# Public batch summary endpoint — exercised even without a token
parse_response "$(request GET "/things/votes?thingIds=1,2,3")"
assert_status "GET /things/votes?thingIds=… (anonymous)" 200 "$RESPONSE_STATUS"

# Mutually-exclusive query: providing both must be rejected
parse_response "$(request GET "/things/votes?thingIds=1&sectionId=nnils")"
assert_status "GET /things/votes (both params rejected)" 400 "$RESPONSE_STATUS"

# Neither param is also rejected
parse_response "$(request GET "/things/votes")"
assert_status "GET /things/votes (no params rejected)" 400 "$RESPONSE_STATUS"

if [ -n "$ACCESS_TOKEN" ]; then
    parse_response "$(request PUT /things/1/vote "{\"vote\":\"like\"}" "$ACCESS_TOKEN")"
    assert_status "PUT /things/1/vote (like)" 200 "$RESPONSE_STATUS"

    # Authenticated batch fetch should now reflect the like
    parse_response "$(request GET "/things/votes?thingIds=1" "" "$ACCESS_TOKEN")"
    assert_status "GET /things/votes?thingIds=1 (authenticated)" 200 "$RESPONSE_STATUS"

    parse_response "$(request PUT /things/1/vote "{\"vote\":\"dislike\"}" "$ACCESS_TOKEN")"
    assert_status "PUT /things/1/vote (dislike)" 200 "$RESPONSE_STATUS"

    parse_response "$(request PUT /things/1/vote "{\"vote\":null}" "$ACCESS_TOKEN")"
    assert_status "PUT /things/1/vote (remove)" 200 "$RESPONSE_STATUS"
else
    red "  SKIP  Voting (no access token)"
    FAIL=$((FAIL + 4))
fi
