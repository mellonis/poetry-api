export const thingFields = `
	thing_id                        AS id,
	thing_category_id               AS categoryId,
	thing_title                     AS title,
	thing_first_lines               AS firstLines,
	cast(thing_start_date AS char)  AS startDate,
	cast(thing_finish_date AS char) AS finishDate,
	thing_last_modified             AS lastModified,
	thing_text                      AS text,
	thing_seo_description           AS seoDescription,
	thing_seo_keywords              AS seoKeywords,
	thing_info                      AS info,
	(SELECT CONCAT('[', GROUP_CONCAT(JSON_QUOTE(text) ORDER BY \`order\`, id SEPARATOR ','), ']')
	 FROM thing_note
	 WHERE r_thing_id = thing_id)   AS notes,
	(SELECT COUNT(*) FROM vote WHERE r_thing_id = thing_id AND vote > 0) AS votesLikes,
	(SELECT COUNT(*) FROM vote WHERE r_thing_id = thing_id AND vote < 0) AS votesDislikes
`;

export const userVoteField = `
	(SELECT vote FROM vote WHERE r_thing_id = thing_id AND r_user_id = ?) AS userVote
`;
