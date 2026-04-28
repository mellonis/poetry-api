# 10c. CMS section-thing interactions
bold ""
bold "10c. CMS section-thing interactions"

if [ "$CMS_READY" != "true" ]; then
    red "  SKIP  CMS section-thing interactions (CMS setup failed)"
elif [ -n "$ACCESS_TOKEN" ]; then
    # Create a section and two things for testing
    parse_response "$(request POST /cms/sections "{\"identifier\":\"smint\",\"title\":\"Smoke Interaction\",\"typeId\":1}" "$ACCESS_TOKEN")"
    assert_status "POST /cms/sections (for interaction test)" 201 "$RESPONSE_STATUS"
    INT_SECTION_ID=$(echo "$RESPONSE_BODY" | grep -o '"id":[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')

    parse_response "$(request POST /cms/things "{\"text\":\"Thing A\",\"categoryId\":1,\"finishDate\":\"2026-01-01\"}" "$ACCESS_TOKEN")"
    THING_A_ID=$(echo "$RESPONSE_BODY" | grep -o '"id":[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')

    parse_response "$(request POST /cms/things "{\"text\":\"Thing B\",\"categoryId\":1,\"finishDate\":\"2026-01-02\"}" "$ACCESS_TOKEN")"
    THING_B_ID=$(echo "$RESPONSE_BODY" | grep -o '"id":[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')

    if [ -n "$INT_SECTION_ID" ] && [ -n "$THING_A_ID" ] && [ -n "$THING_B_ID" ]; then
        # Add things to section
        parse_response "$(request POST "/cms/sections/${INT_SECTION_ID}/things" "{\"thingId\":${THING_A_ID}}" "$ACCESS_TOKEN")"
        assert_status "POST /cms/sections/:sectionId/things (add A)" 201 "$RESPONSE_STATUS"

        parse_response "$(request POST "/cms/sections/${INT_SECTION_ID}/things" "{\"thingId\":${THING_B_ID}}" "$ACCESS_TOKEN")"
        assert_status "POST /cms/sections/:sectionId/things (add B)" 201 "$RESPONSE_STATUS"

        # Reorder things in section
        parse_response "$(request PUT "/cms/sections/${INT_SECTION_ID}/things/reorder" "[${THING_B_ID},${THING_A_ID}]" "$ACCESS_TOKEN")"
        assert_status "PUT /cms/sections/:sectionId/things/reorder" 200 "$RESPONSE_STATUS"

        # Delete thing that is in section — should fail
        parse_response "$(request DELETE "/cms/things/${THING_A_ID}" "" "$ACCESS_TOKEN")"
        assert_status "DELETE /cms/things/:thingId (in section, expect 409)" 409 "$RESPONSE_STATUS"

        # Remove things from section
        parse_response "$(request DELETE "/cms/sections/${INT_SECTION_ID}/things/${THING_A_ID}" "" "$ACCESS_TOKEN")"
        assert_status "DELETE /cms/sections/:sectionId/things/:thingId (remove A)" 204 "$RESPONSE_STATUS"

        parse_response "$(request DELETE "/cms/sections/${INT_SECTION_ID}/things/${THING_B_ID}" "" "$ACCESS_TOKEN")"
        assert_status "DELETE /cms/sections/:sectionId/things/:thingId (remove B)" 204 "$RESPONSE_STATUS"

        # Now delete things (should succeed)
        parse_response "$(request DELETE "/cms/things/${THING_A_ID}" "" "$ACCESS_TOKEN")"
        assert_status "DELETE /cms/things/:thingId (A, after removal)" 204 "$RESPONSE_STATUS"

        parse_response "$(request DELETE "/cms/things/${THING_B_ID}" "" "$ACCESS_TOKEN")"
        assert_status "DELETE /cms/things/:thingId (B, after removal)" 204 "$RESPONSE_STATUS"

        # Delete section
        parse_response "$(request DELETE "/cms/sections/${INT_SECTION_ID}" "" "$ACCESS_TOKEN")"
        assert_status "DELETE /cms/sections/:sectionId (interaction cleanup)" 204 "$RESPONSE_STATUS"
    else
        red "  SKIP  CMS section-thing interactions (could not create test data)"
        FAIL=$((FAIL + 8))
    fi
else
    red "  SKIP  CMS section-thing interactions (no access token)"
    FAIL=$((FAIL + 9))
fi
