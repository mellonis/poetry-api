# 11b. Comments
bold ""
bold "11b. Comments"

if [ -n "$ACCESS_TOKEN" ]; then
    parse_response "$(request GET /comments?thingId=1)"
    assert_status "GET /comments?thingId=1 (public)" 200 "$RESPONSE_STATUS"

    parse_response "$(request GET "/comments?scope=site")"
    assert_status "GET /comments?scope=site (guestbook)" 200 "$RESPONSE_STATUS"

    # Conflicting params: thingId + scope=site
    parse_response "$(request GET "/comments?thingId=1&scope=site")"
    assert_status "GET /comments?thingId=1&scope=site (rejected)" 400 "$RESPONSE_STATUS"

    # Post a guestbook entry
    parse_response "$(request POST /comments "{\"text\":\"smoke test guestbook ${TIMESTAMP}\"}" "$ACCESS_TOKEN")"
    assert_status "POST /comments (guestbook)" 201 "$RESPONSE_STATUS"
    GUESTBOOK_COMMENT_ID=$(echo "$RESPONSE_BODY" | grep -o '"id":[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')

    if [ -n "$GUESTBOOK_COMMENT_ID" ]; then
        # Vote on own comment (self-vote allowed by design)
        parse_response "$(request PUT "/comments/${GUESTBOOK_COMMENT_ID}/vote" "{\"vote\":\"like\"}" "$ACCESS_TOKEN")"
        assert_status "PUT /comments/:commentId/vote (like)" 200 "$RESPONSE_STATUS"

        parse_response "$(request PUT "/comments/${GUESTBOOK_COMMENT_ID}/vote" "{\"vote\":null}" "$ACCESS_TOKEN")"
        assert_status "PUT /comments/:commentId/vote (remove)" 200 "$RESPONSE_STATUS"

        # Edit within window
        parse_response "$(request PUT "/comments/${GUESTBOOK_COMMENT_ID}" "{\"text\":\"edited smoke test ${TIMESTAMP}\"}" "$ACCESS_TOKEN")"
        assert_status "PUT /comments/:commentId (edit)" 200 "$RESPONSE_STATUS"

        # Self-delete (sets status=Deleted)
        parse_response "$(request DELETE "/comments/${GUESTBOOK_COMMENT_ID}" "" "$ACCESS_TOKEN")"
        assert_status "DELETE /comments/:commentId (self-delete)" 200 "$RESPONSE_STATUS"

        # Edit after delete should fail
        parse_response "$(request PUT "/comments/${GUESTBOOK_COMMENT_ID}" "{\"text\":\"too late\"}" "$ACCESS_TOKEN")"
        assert_status "PUT /comments/:commentId (after delete)" 409 "$RESPONSE_STATUS"
    else
        red "  SKIP  Comment lifecycle (no comment id parsed)"
        FAIL=$((FAIL + 6))
    fi

    # Auth gates
    parse_response "$(request POST /comments "{\"text\":\"anonymous post\"}")"
    assert_status "POST /comments (no token)" 401 "$RESPONSE_STATUS"

    # Sanitization rejects empty / flooded text
    parse_response "$(request POST /comments "{\"text\":\"\"}" "$ACCESS_TOKEN")"
    assert_status "POST /comments (empty)" 400 "$RESPONSE_STATUS"

    # CMS access denied for non-editor
    parse_response "$(request GET /cms/comments "" "$ACCESS_TOKEN")"
    assert_status "GET /cms/comments (non-editor)" 403 "$RESPONSE_STATUS"
else
    red "  SKIP  Comments (no access token)"
    FAIL=$((FAIL + 12))
fi
