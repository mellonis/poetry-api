export const upsertVoteQuery = `
	INSERT INTO vote (r_thing_id, r_user_id, vote, date)
	VALUES (?, ?, ?, CURDATE())
	ON DUPLICATE KEY UPDATE vote = VALUES(vote), date = CURDATE()
`;

export const deleteVoteQuery = `
	DELETE FROM vote
	WHERE r_thing_id = ? AND r_user_id = ?
`;

export const thingTitleQuery = `
	SELECT title, first_lines AS firstLines FROM thing WHERE id = ?
`;

// Aggregate counts per thing in a single round-trip. The IN-list size is
// validated/capped at the schema layer (max 100). Anonymous users pass
// `userId = 0` — that never matches a real auth_user.id (auto-increment
// starts at 1), so userVote stays 0 → null on the wire.
export const voteSummariesQuery = (idCount: number) => `
	SELECT
		r_thing_id AS thingId,
		COUNT(CASE WHEN vote > 0 THEN 1 END) AS likes,
		COUNT(CASE WHEN vote < 0 THEN 1 END) AS dislikes,
		COALESCE(SUM(CASE WHEN r_user_id = ? THEN vote ELSE 0 END), 0) AS userVote
	FROM vote
	WHERE r_thing_id IN (${Array(idCount).fill('?').join(',')})
	GROUP BY r_thing_id
`;

// All things in a section + their global vote summaries (a thing's votes are
// global, not section-scoped). LEFT JOIN keeps things with zero votes;
// anonymous users pass `userId = 0` (no real auth_user.id matches → userVote
// stays 0 → null on the wire). Uses `v_things_info` to inherit the same
// canonical-thing filtering the public sections endpoints already use
// (handles redirect rows etc.).
export const voteSummariesBySectionQuery = `
	SELECT
		ti.thing_id AS thingId,
		COUNT(CASE WHEN v.vote > 0 THEN 1 END) AS likes,
		COUNT(CASE WHEN v.vote < 0 THEN 1 END) AS dislikes,
		COALESCE(SUM(CASE WHEN v.r_user_id = ? THEN v.vote ELSE 0 END), 0) AS userVote
	FROM v_things_info ti
	LEFT JOIN vote v ON v.r_thing_id = ti.thing_id
	WHERE ti.section_identifier = ?
	GROUP BY ti.thing_id
`;
