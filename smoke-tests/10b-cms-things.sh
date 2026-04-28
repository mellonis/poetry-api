# 10b. CMS thing CRUD
bold ""
bold "10b. CMS thing CRUD"

if [ "$CMS_READY" != "true" ]; then
    red "  SKIP  CMS thing CRUD (CMS setup failed)"
elif [ -n "$ACCESS_TOKEN" ]; then
    # Create thing
    parse_response "$(request POST /cms/things "{\"text\":\"Smoke test poem\\nSecond line\",\"categoryId\":1,\"finishDate\":\"2026-01-01\"}" "$ACCESS_TOKEN")"
    assert_status "POST /cms/things (create)" 201 "$RESPONSE_STATUS"
    THING_ID=$(echo "$RESPONSE_BODY" | grep -o '"id":[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')

    if [ -n "$THING_ID" ]; then
        # Get thing
        parse_response "$(request GET "/cms/things/${THING_ID}" "" "$ACCESS_TOKEN")"
        assert_status "GET /cms/things/:thingId" 200 "$RESPONSE_STATUS"

        # Update thing
        parse_response "$(request PUT "/cms/things/${THING_ID}" "{\"title\":\"Smoke Title\",\"statusId\":2,\"notes\":[{\"text\":\"Note 1\"},{\"text\":\"Note 2\"}],\"seoDescription\":\"Test desc\",\"seoKeywords\":\"test,smoke\"}" "$ACCESS_TOKEN")"
        assert_status "PUT /cms/things/:thingId (update)" 200 "$RESPONSE_STATUS"

        # Update notes (reorder + add)
        NOTE_1_ID=$(echo "$RESPONSE_BODY" | grep -o '"notes":\[{"id":[0-9]*' | grep -o '[0-9]*$')
        if [ -n "$NOTE_1_ID" ]; then
            parse_response "$(request PUT "/cms/things/${THING_ID}" "{\"notes\":[{\"text\":\"New note\"},{\"id\":${NOTE_1_ID},\"text\":\"Note 1 updated\"}]}" "$ACCESS_TOKEN")"
            assert_status "PUT /cms/things/:thingId (reorder notes)" 200 "$RESPONSE_STATUS"
        fi

        # Delete thing
        parse_response "$(request DELETE "/cms/things/${THING_ID}" "" "$ACCESS_TOKEN")"
        assert_status "DELETE /cms/things/:thingId" 204 "$RESPONSE_STATUS"
    else
        red "  SKIP  CMS thing CRUD (could not extract thing ID)"
        FAIL=$((FAIL + 4))
    fi
else
    red "  SKIP  CMS thing CRUD (no access token)"
    FAIL=$((FAIL + 5))
fi
