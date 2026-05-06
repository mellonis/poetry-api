// "Site author" id — the user whose comments get the (Автор сайта) badge.
// Decoupled from the workspace's "root admin" id (1) since the actual site
// owner may post under a different account. Default 1 keeps existing dev/test
// behavior; prod sets SITE_AUTHOR_USER_ID in .env.
const SITE_AUTHOR_USER_ID = Number(process.env.SITE_AUTHOR_USER_ID) || 1;

// Common SELECT body for a comment row, parameterized by the caller's userId
// (or 0 for anonymous — never matches a real auth_user.id, so userVote stays 0).
const commentRowFields = `
  c.id,
  c.parent_id AS parentId,
  c.r_thing_id AS thingId,
  c.r_user_id AS userId,
  c.display_name_snapshot AS authorDisplayName,
  (c.r_user_id = ${SITE_AUTHOR_USER_ID}) AS isAuthor,
  c.text,
  c.r_comment_status_id AS statusId,
  c.created_at AS createdAt,
  c.updated_at AS updatedAt,
  COALESCE(SUM(CASE WHEN cv.vote = 1 THEN 1 ELSE 0 END), 0) AS likes,
  COALESCE(SUM(CASE WHEN cv.vote = -1 THEN 1 ELSE 0 END), 0) AS dislikes,
  COALESCE(SUM(CASE WHEN cv.r_user_id = ? THEN cv.vote ELSE 0 END), 0) AS userVote
`;

// <=> is MySQL's NULL-safe equality: r_thing_id IS NULL when ? is NULL,
// r_thing_id = ? when ? is a number. Lets one query serve both
// "guestbook" (?=NULL) and "per-thing" (?=N) reads.
export const topLevelCommentsQuery = `
  SELECT
    ${commentRowFields},
    EXISTS(
      SELECT 1 FROM comment c2
      WHERE c2.parent_id = c.id AND c2.r_comment_status_id = 1
    ) AS hasVisibleChild
  FROM comment c
  LEFT JOIN comment_vote cv ON cv.r_comment_id = c.id
  WHERE c.parent_id IS NULL AND c.r_thing_id <=> ?
  GROUP BY c.id
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT ? OFFSET ?
`;

export const repliesByParentIdsQuery = `
  SELECT ${commentRowFields}
  FROM comment c
  LEFT JOIN comment_vote cv ON cv.r_comment_id = c.id
  WHERE c.parent_id IN (?)
  GROUP BY c.id
  ORDER BY c.parent_id, c.created_at ASC, c.id ASC
`;

// Total visible comments for the "Комментарии (N)" header — counts both
// top-level rows and replies. Pagination's hasMore is computed separately
// from the items.length === limit check, so the two can diverge cleanly.
export const topLevelCommentCountQuery = `
  SELECT COUNT(*) AS total
  FROM comment
  WHERE r_thing_id <=> ?
    AND r_comment_status_id = 1
`;

export const commentByIdQuery = `
  SELECT
    ${commentRowFields},
    EXISTS(
      SELECT 1 FROM comment c2
      WHERE c2.parent_id = c.id AND c2.r_comment_status_id = 1
    ) AS hasVisibleChild
  FROM comment c
  LEFT JOIN comment_vote cv ON cv.r_comment_id = c.id
  WHERE c.id = ?
  GROUP BY c.id
`;

// Lookup for the single-comment response: any one (sectionIdentifier,
// positionInSection) pair for a thing that lives in multiple sections.
// Same convention as commentReplyContextQuery — any link lands on the same
// comment thread (Comments widget keys by thingId, not section). ORDER BY
// ti.id keeps the choice stable across calls so the rendered URL doesn't
// flicker between renders.
export const thingSectionContextQuery = `
  SELECT
    s.identifier               AS sectionIdentifier,
    ti.thing_position_in_section AS positionInSection
  FROM thing_identifier ti
  JOIN section s ON s.id = ti.r_section_id
  WHERE ti.r_thing_id = ?
  ORDER BY ti.id ASC
  LIMIT 1
`;

// Used for parent validation on insert + edit-window / ownership / status checks
// on update / delete.
export const commentMetaByIdQuery = `
  SELECT
    id,
    r_user_id AS userId,
    r_thing_id AS thingId,
    parent_id AS parentId,
    r_comment_status_id AS statusId,
    created_at AS createdAt
  FROM comment
  WHERE id = ?
`;

export const insertCommentQuery = `
  INSERT INTO comment
    (r_user_id, r_thing_id, parent_id, text, r_comment_status_id,
     status_changed_at, status_changed_by_user_id, display_name_snapshot)
  VALUES (?, ?, ?, ?, 1, NOW(), ?,
    (SELECT COALESCE(display_name, login) FROM auth_user WHERE id = ?))
`;

export const updateCommentTextQuery = `
  UPDATE comment SET text = ? WHERE id = ?
`;

export const setCommentStatusQuery = `
  UPDATE comment
  SET r_comment_status_id = ?,
      status_changed_at = NOW(),
      status_changed_by_user_id = ?
  WHERE id = ?
`;

export const hardDeleteCommentQuery = `
  DELETE FROM comment WHERE id = ?
`;

export const upsertCommentVoteQuery = `
  INSERT INTO comment_vote (r_comment_id, r_user_id, vote)
  VALUES (?, ?, ?)
  ON DUPLICATE KEY UPDATE vote = VALUES(vote)
`;

export const deleteCommentVoteQuery = `
  DELETE FROM comment_vote WHERE r_comment_id = ? AND r_user_id = ?
`;

export const commentVoteCountsQuery = `
  SELECT
    COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0) AS likes,
    COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0) AS dislikes
  FROM comment_vote WHERE r_comment_id = ?
`;

export const userCommentVoteQuery = `
  SELECT vote FROM comment_vote WHERE r_comment_id = ? AND r_user_id = ?
`;

// Lookup for reply notifications: parent author email/login + ban check, plus
// section identifier + position for the deep-link URL when the comment is on
// a thing. Returns at most one section row per thing — picks any when a thing
// belongs to multiple sections (acceptable: any link lands on the comment).
export const commentReplyContextQuery = `
  SELECT
    pc.r_user_id  AS authorUserId,
    pc.r_thing_id AS thingId,
    u.login       AS authorLogin,
    u.email       AS authorEmail,
    u.rights      AS authorUserRights,
    g.rights      AS authorGroupRights,
    u.notify_author_on_comment_reply AS authorNotifyOnReply,
    s.identifier               AS sectionIdentifier,
    ti.thing_position_in_section AS positionInSection
  FROM comment pc
  LEFT JOIN auth_user u  ON u.id = pc.r_user_id
  LEFT JOIN auth_group g ON g.id = u.r_group_id
  LEFT JOIN thing_identifier ti ON ti.r_thing_id = pc.r_thing_id
  LEFT JOIN section s    ON s.id = ti.r_section_id
  WHERE pc.id = ?
  LIMIT 1
`;

// Lookup for vote notifications: same as reply context but also returns the
// voted comment's text (for the email excerpt) and parent_id (to derive the
// top-level thread id — top-level comment → own id; reply → parent_id).
export const commentVoteContextQuery = `
  SELECT
    c.r_user_id   AS authorUserId,
    c.r_thing_id  AS thingId,
    c.parent_id   AS parentId,
    c.text        AS commentText,
    u.login       AS authorLogin,
    u.email       AS authorEmail,
    u.rights      AS authorUserRights,
    g.rights      AS authorGroupRights,
    u.notify_author_on_comment_vote AS authorNotifyOnVote,
    s.identifier               AS sectionIdentifier,
    ti.thing_position_in_section AS positionInSection
  FROM comment c
  LEFT JOIN auth_user u  ON u.id = c.r_user_id
  LEFT JOIN auth_group g ON g.id = u.r_group_id
  LEFT JOIN thing_identifier ti ON ti.r_thing_id = c.r_thing_id
  LEFT JOIN section s    ON s.id = ti.r_section_id
  WHERE c.id = ?
  LIMIT 1
`;

export const repliesByParentIdQuery = `
  SELECT ${commentRowFields}
  FROM comment c
  LEFT JOIN comment_vote cv ON cv.r_comment_id = c.id
  WHERE c.parent_id = ?
  GROUP BY c.id
  ORDER BY c.created_at ASC, c.id ASC
`;

export const upsertCommentReportQuery = `
  INSERT INTO comment_report (r_comment_id, r_user_id, reason)
  VALUES (?, ?, ?)
  ON DUPLICATE KEY UPDATE reason = VALUES(reason), created_at = CURRENT_TIMESTAMP
`;

export const resolveReportsForCommentQuery = `
  UPDATE comment_report
  SET resolved_at = NOW(), resolved_by_user_id = ?
  WHERE r_comment_id = ? AND resolved_at IS NULL
`;

// CMS list — same row shape as public, plus unresolved report count.
const cmsCommentRowFields = `
  c.id,
  c.parent_id AS parentId,
  c.r_thing_id AS thingId,
  t.title AS thingTitle,
  t.first_lines AS thingFirstLines,
  c.r_user_id AS userId,
  u.login AS authorLogin,
  c.display_name_snapshot AS authorDisplayName,
  (c.r_user_id = ${SITE_AUTHOR_USER_ID}) AS isAuthor,
  c.text,
  c.r_comment_status_id AS statusId,
  c.created_at AS createdAt,
  c.updated_at AS updatedAt,
  c.status_changed_at AS statusChangedAt,
  c.status_changed_by_user_id AS statusChangedByUserId,
  COALESCE(SUM(CASE WHEN cv.vote = 1 THEN 1 ELSE 0 END), 0) AS likes,
  COALESCE(SUM(CASE WHEN cv.vote = -1 THEN 1 ELSE 0 END), 0) AS dislikes,
  (SELECT COUNT(*) FROM comment_report cr
   WHERE cr.r_comment_id = c.id AND cr.resolved_at IS NULL) AS reportCount
`;

export const buildCmsCommentListQuery = (filters: {
	statusId?: number;
	scopeFilter?: 'site' | 'thing';
	thingId?: number;
	userId?: number;
	onlyReported?: boolean;
}) => {
	const wheres: string[] = [];
	if (filters.statusId !== undefined) wheres.push('c.r_comment_status_id = ?');
	if (filters.scopeFilter === 'site') wheres.push('c.r_thing_id IS NULL');
	if (filters.scopeFilter === 'thing') wheres.push('c.r_thing_id IS NOT NULL');
	if (filters.thingId !== undefined) wheres.push('c.r_thing_id = ?');
	if (filters.userId !== undefined) wheres.push('c.r_user_id = ?');
	if (filters.onlyReported) wheres.push('EXISTS(SELECT 1 FROM comment_report cr WHERE cr.r_comment_id = c.id AND cr.resolved_at IS NULL)');

	const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

	const list = `
    SELECT ${cmsCommentRowFields}
    FROM comment c
    LEFT JOIN auth_user u ON u.id = c.r_user_id
    LEFT JOIN comment_vote cv ON cv.r_comment_id = c.id
    LEFT JOIN thing t ON t.id = c.r_thing_id
    ${where}
    GROUP BY c.id
    ORDER BY reportCount DESC, c.created_at DESC, c.id DESC
    LIMIT ? OFFSET ?
  `;

	const count = `SELECT COUNT(*) AS total FROM comment c ${where}`;

	return { list, count };
};
