// SQL constants for the notifications plugin. All read queries apply the
// visibility filter (subject Visible; object NULL or Visible) so moderated
// comments fall out of both the badge count and the feed.

const visibilityJoin = `
  JOIN comment cs ON cs.id = n.r_subject_comment_id AND cs.r_comment_status_id = 1
  LEFT JOIN comment co ON co.id = n.r_object_comment_id
`;

const visibilityWhere = `
  AND (n.r_object_comment_id IS NULL OR co.r_comment_status_id = 1)
`;

// SUMMARY -----------------------------------------------------------------

export const countUnreadQuery = `
  SELECT COUNT(*) AS cnt
  FROM notification n
  ${visibilityJoin}
  WHERE n.r_user_id = ?
    AND n.is_read = 0
    ${visibilityWhere}
`;

// LIST --------------------------------------------------------------------
// Note: caller fetches LIMIT+1 rows so it can detect "more pages exist"
// and emit a nextCursor. The keyset compares (updated_at, id) strictly less
// than the cursor — equal-timestamp rows are tie-broken by id DESC.

export const listNotificationsBaseQuery = `
  SELECT
    n.id,
    n.r_notification_type_id AS typeId,
    nt.code AS typeCode,
    n.event_count AS eventCount,
    n.is_read AS isRead,
    n.created_at AS createdAt,
    n.updated_at AS updatedAt,
    cs.id AS subjectId,
    cs.text AS subjectText,
    COALESCE(cs.parent_id, cs.id) AS threadCommentId,
    cs.r_thing_id AS subjectThingId,
    co.id AS objectId,
    co.text AS objectText,
    co.r_user_id AS objectAuthorUserId,
    co.display_name_snapshot AS objectAuthorDisplayName,
    sec.identifier AS sectionIdentifier,
    ti.thing_position_in_section AS positionInSection
  FROM notification n
  JOIN notification_type nt ON nt.id = n.r_notification_type_id
  ${visibilityJoin}
  LEFT JOIN thing_identifier ti
    ON ti.r_thing_id = cs.r_thing_id
   AND ti.r_redirect_thing_identifier_id IS NULL
  LEFT JOIN section sec
    ON sec.id = ti.r_section_id
   AND sec.r_section_status_id IN (2, 3)
  WHERE n.r_user_id = ?
    {{UNREAD_FILTER}}
    {{CURSOR_FILTER}}
    ${visibilityWhere}
  ORDER BY n.updated_at DESC, n.id DESC
  LIMIT ?
`;

// MARK READ ---------------------------------------------------------------

export const markReadQuery = `
  UPDATE notification
  SET is_read = 1, read_at = NOW()
  WHERE id = ? AND r_user_id = ? AND is_read = 0
`;

export const markAllReadQuery = `
  UPDATE notification
  SET is_read = 1, read_at = NOW()
  WHERE r_user_id = ? AND is_read = 0
`;

// DELETE ------------------------------------------------------------------

export const deleteNotificationQuery = `
  DELETE FROM notification
  WHERE id = ? AND r_user_id = ?
`;

// VOTE BUCKET UPSERT ------------------------------------------------------
// These two statements run in a single transaction with FOR UPDATE on the
// SELECT. The helper in lib/notifications.ts owns the BEGIN/COMMIT.

export const findUnreadVoteBucketQuery = `
  SELECT id FROM notification
  WHERE r_user_id = ?
    AND r_subject_comment_id = ?
    AND r_notification_type_id = 2
    AND is_read = 0
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE
`;

export const incrementVoteBucketQuery = `
  UPDATE notification
  SET event_count = event_count + 1
  WHERE id = ?
`;

export const insertNotificationQuery = `
  INSERT INTO notification
    (r_user_id, r_notification_type_id, r_subject_comment_id, r_object_comment_id)
  VALUES (?, ?, ?, ?)
`;
