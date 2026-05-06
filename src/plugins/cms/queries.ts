// --- Section types ---

export const sectionTypesQuery = `
	SELECT id, title FROM section_type ORDER BY id;
`;

export const sectionStatusesQuery = `
	SELECT id, title FROM section_status ORDER BY id;
`;

// --- Sections ---

export const cmsSectionsQuery = `
	SELECT
		s.id,
		s.identifier,
		s.title,
		s.description,
		s.annotation_text             AS annotationText,
		s.annotation_author           AS annotationAuthor,
		s.r_section_type_id           AS typeId,
		s.r_section_status_id         AS statusId,
		s.r_redirect_section_id       AS redirectSectionId,
		s.settings,
		s.\`order\`
	FROM section s
	ORDER BY s.\`order\`, s.id;
`;

export const cmsSectionByIdQuery = `
	SELECT
		s.id,
		s.identifier,
		s.title,
		s.description,
		s.annotation_text             AS annotationText,
		s.annotation_author           AS annotationAuthor,
		s.r_section_type_id           AS typeId,
		s.r_section_status_id         AS statusId,
		s.r_redirect_section_id       AS redirectSectionId,
		s.settings,
		s.\`order\`
	FROM section s
	WHERE s.id = ?;
`;

export const createSectionQuery = `
	INSERT INTO section (identifier, title, description, annotation_text, annotation_author, r_section_type_id, r_section_status_id, r_redirect_section_id, settings, \`order\`)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

export const updateSectionQuery = `
	UPDATE section
	SET title = ?, description = ?, annotation_text = ?, annotation_author = ?,
		r_section_type_id = ?, r_section_status_id = ?, r_redirect_section_id = ?, settings = ?
	WHERE id = ?;
`;

export const deleteSectionQuery = `
	DELETE FROM section WHERE id = ?;
`;

export const deleteAllThingsInSectionQuery = `
	DELETE FROM thing_identifier WHERE r_section_id = ?;
`;

export const externalRedirectsToSectionQuery = `
	SELECT
		ext.r_section_id AS fromSectionId,
		s.identifier AS fromSectionIdentifier,
		ext.r_thing_id AS fromThingId
	FROM thing_identifier ext
	JOIN thing_identifier target ON ext.r_redirect_thing_identifier_id = target.id
	JOIN section s ON ext.r_section_id = s.id
	WHERE target.r_section_id = ? AND ext.r_section_id != ?;
`;

export const updateSectionOrderQuery = `
	UPDATE section SET \`order\` = ? WHERE id = ?;
`;

export const shiftSectionOrdersQuery = `
	UPDATE section SET \`order\` = \`order\` + 1
	WHERE r_section_status_id != 4 AND \`order\` >= ?;
`;

export const maxSectionOrderQuery = `
	SELECT COALESCE(MAX(\`order\`), 0) AS maxOrder
	FROM section WHERE r_section_status_id != 4;
`;

// For redirect loop detection
export const allSectionRedirectsQuery = `
	SELECT id, r_redirect_section_id AS redirectSectionId
	FROM section;
`;

// --- Things in section ---

export const cmsSectionThingsQuery = `
	SELECT
		ti.r_thing_id                  AS thingId,
		ti.thing_position_in_section   AS position,
		t.title,
		t.first_lines                  AS firstLines
	FROM thing_identifier ti
	JOIN thing t ON ti.r_thing_id = t.id
	WHERE ti.r_section_id = ?
	ORDER BY ti.thing_position_in_section;
`;

export const addThingToSectionQuery = `
	INSERT INTO thing_identifier (r_section_id, thing_position_in_section, r_thing_id)
	VALUES (?, ?, ?);
`;

export const maxThingPositionQuery = `
	SELECT COALESCE(MAX(thing_position_in_section), 0) AS maxPosition
	FROM thing_identifier WHERE r_section_id = ?;
`;

export const shiftThingPositionsQuery = `
	UPDATE thing_identifier
	SET thing_position_in_section = thing_position_in_section + 1
	WHERE r_section_id = ? AND thing_position_in_section >= ?;
`;

export const removeThingFromSectionQuery = `
	DELETE FROM thing_identifier WHERE r_section_id = ? AND r_thing_id = ?;
`;

export const updateThingPositionQuery = `
	UPDATE thing_identifier
	SET thing_position_in_section = ?
	WHERE r_section_id = ? AND r_thing_id = ?;
`;

export const thingExistsQuery = `
	SELECT id FROM thing WHERE id = ?;
`;

export const allThingsQuery = `
	SELECT
		t.id          AS thingId,
		t.title,
		t.first_lines AS firstLines
	FROM thing t
	ORDER BY t.id DESC;
`;

export const sectionThingIdsQuery = `
	SELECT r_thing_id AS thingId
	FROM thing_identifier
	WHERE r_section_id = ?
	ORDER BY thing_position_in_section;
`;

// --- Author (news id=1) ---

export const cmsAuthorQuery = `
	SELECT
		n.text,
		CAST(n.date AS CHAR) AS date,
		n.seo_description     AS seoDescription,
		n.seo_keywords        AS seoKeywords
	FROM news n
	WHERE n.id = 1;
`;

export const updateAuthorQuery = `
	UPDATE news
	SET text = ?, date = ?, seo_description = ?, seo_keywords = ?
	WHERE id = 1;
`;

// --- Thing CRUD ---

export const thingStatusesQuery = `
	SELECT id, title FROM thing_status ORDER BY id;
`;

export const thingCategoriesQuery = `
	SELECT id, title FROM thing_category ORDER BY id;
`;

export const cmsThingByIdQuery = `
	SELECT
		t.id,
		t.title,
		t.text,
		t.r_thing_category_id          AS categoryId,
		t.r_thing_status_id            AS statusId,
		CAST(t.start_date AS CHAR)     AS startDate,
		CAST(t.finish_date AS CHAR)    AS finishDate,
		t.first_lines                  AS firstLines,
		t.first_lines_auto_generating  AS firstLinesAutoGenerating,
		t.exclude_from_daily           AS excludeFromDaily,
		ts.description                 AS seoDescription,
		ts.keywords                    AS seoKeywords,
		ti.text                        AS info
	FROM thing t
	LEFT JOIN thing_seo ts ON ts.r_thing_id = t.id
	LEFT JOIN thing_info ti ON ti.r_thing_id = t.id
	WHERE t.id = ?;
`;

export const thingNotesQuery = `
	SELECT id, text FROM thing_note WHERE r_thing_id = ? ORDER BY \`order\`, id;
`;

export const createThingQuery = `
	INSERT INTO thing (title, text, r_thing_category_id, r_thing_status_id, start_date, finish_date,
		first_lines, first_lines_auto_generating, exclude_from_daily, last_modified)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW());
`;

export const updateThingQuery = `
	UPDATE thing SET
		title = ?, text = ?, r_thing_category_id = ?, r_thing_status_id = ?,
		start_date = ?, finish_date = ?,
		first_lines = ?, first_lines_auto_generating = ?, exclude_from_daily = ?,
		last_modified = NOW()
	WHERE id = ?;
`;

export const deleteThingQuery = `
	DELETE FROM thing WHERE id = ?;
`;

export const thingInSectionsCountQuery = `
	SELECT COUNT(*) AS cnt FROM thing_identifier WHERE r_thing_id = ?;
`;

export const upsertThingSeoQuery = `
	INSERT INTO thing_seo (r_thing_id, description, keywords)
	VALUES (?, ?, ?)
	ON DUPLICATE KEY UPDATE description = VALUES(description), keywords = VALUES(keywords);
`;

export const deleteThingSeoQuery = `
	DELETE FROM thing_seo WHERE r_thing_id = ?;
`;

export const upsertThingInfoQuery = `
	INSERT INTO thing_info (r_thing_id, text)
	VALUES (?, ?)
	ON DUPLICATE KEY UPDATE text = VALUES(text);
`;

export const deleteThingInfoQuery = `
	DELETE FROM thing_info WHERE r_thing_id = ?;
`;

export const insertThingNoteQuery = `
	INSERT INTO thing_note (r_thing_id, text, \`order\`) VALUES (?, ?, ?);
`;

export const updateThingNoteQuery = `
	UPDATE thing_note SET text = ?, \`order\` = ? WHERE id = ? AND r_thing_id = ?;
`;

export const deleteThingNotesExceptQuery = `
	DELETE FROM thing_note WHERE r_thing_id = ? AND id NOT IN (?);
`;

export const deleteAllThingNotesQuery = `
	DELETE FROM thing_note WHERE r_thing_id = ?;
`;

// --- Things-of-the-day calendar ---
//
// Rolling 365/366-day window starting today. For each day in the window:
//   - "curated" rows: things whose finish_date matches the day's MM-DD (full
//     date), or whose finish_date is YYYY-MM-00 and the day is the last day
//     of that month within the window.
//   - "fallback" row: when the curated bucket is empty, one thing picked
//     deterministically by MD5 hash (matches the live endpoint's per-day
//     stable random pick — see issue #130 for why MD5 and not RAND).
// finish_date = '0000-00-00' (year-only or undated) is excluded from curated;
// undated things may still surface as fallback picks.
//
// Filter alignment with the public /things-of-the-day endpoint (#134): a
// thing must (1) have r_thing_status_id IN (2, 3) — Published or Editing —
// and (2) be placed in at least one section that is itself non-deprecated
// (r_section_type_id > 0) and Published-or-Editing (r_section_status_id IN
// (2, 3)). Without this, the CMS calendar would show drafts and withdrawn
// things that won't actually appear publicly, defeating the page's purpose.
//
// LEFT JOINs at the outer level expand to one row per (thing, section)
// placement so the helper can collect a sections: [{id, position}] array per
// entry. The section join also filters non-deprecated AND
// Published-or-Editing sections so chip rows only surface placements that
// the public site would render.
//
// CAST(... AS CHAR) on finish_date is required: mysql2 returns raw DATE
// columns as JS Date objects in CTE/LATERAL contexts, and the response Zod
// schema validates finishDate as a string — see #134.
export const cmsThingsOfTheDayCalendarQuery = `
	WITH RECURSIVE days AS (
		SELECT CURDATE() AS d
		UNION ALL
		SELECT d + INTERVAL 1 DAY FROM days
		WHERE d < CURDATE() + INTERVAL 1 YEAR - INTERVAL 1 DAY
	),
	curated AS (
		SELECT
			d.d AS bucket_day,
			t.id, t.title, t.first_lines AS firstLines,
			CAST(t.finish_date AS CHAR) AS finishDate,
			t.r_thing_status_id AS statusId,
			t.r_thing_category_id AS categoryId
		FROM thing t
		JOIN days d ON (
			(SUBSTRING(t.finish_date, 9, 2) != '00'
				AND SUBSTRING(t.finish_date, 6) = DATE_FORMAT(d.d, '%m-%d'))
			OR
			(SUBSTRING(t.finish_date, 9, 2) = '00' AND SUBSTRING(t.finish_date, 6, 2) != '00'
				AND SUBSTRING(t.finish_date, 6, 2) = DATE_FORMAT(d.d, '%m')
				AND d.d = LAST_DAY(d.d))
		)
		WHERE t.exclude_from_daily = FALSE
		  AND t.r_thing_status_id IN (2, 3)
		  AND EXISTS (
		      SELECT 1 FROM thing_identifier ti
		      JOIN section s ON ti.r_section_id = s.id
		      WHERE ti.r_thing_id = t.id
		        AND s.r_section_type_id > 0
		        AND s.r_section_status_id IN (2, 3)
		  )
	)
	SELECT 'curated' AS kind, DATE_FORMAT(c.bucket_day, '%Y-%m-%d') AS bucketDate,
	       c.id, c.title, c.firstLines, c.finishDate, c.statusId, c.categoryId,
	       s.identifier AS sectionId, ti.thing_position_in_section AS position
	FROM curated c
	LEFT JOIN thing_identifier ti ON ti.r_thing_id = c.id
	LEFT JOIN section s ON ti.r_section_id = s.id
	    AND s.r_section_type_id > 0
	    AND s.r_section_status_id IN (2, 3)

	UNION ALL

	SELECT 'fallback' AS kind, DATE_FORMAT(d.d, '%Y-%m-%d') AS bucketDate,
	       fb.id, fb.title, fb.firstLines, fb.finishDate, fb.statusId, fb.categoryId,
	       s.identifier AS sectionId, ti.thing_position_in_section AS position
	FROM days d
	JOIN LATERAL (
		SELECT id, title, first_lines AS firstLines,
		       CAST(finish_date AS CHAR) AS finishDate,
		       r_thing_status_id AS statusId, r_thing_category_id AS categoryId
		FROM thing
		WHERE exclude_from_daily = FALSE
		  AND r_thing_status_id IN (2, 3)
		  AND SUBSTRING(finish_date, 6, 2) != DATE_FORMAT(d.d, '%m')
		  AND EXISTS (
		      SELECT 1 FROM thing_identifier ti
		      JOIN section s ON ti.r_section_id = s.id
		      WHERE ti.r_thing_id = thing.id
		        AND s.r_section_type_id > 0
		        AND s.r_section_status_id IN (2, 3)
		  )
		ORDER BY MD5(CONCAT(id, ':', TO_DAYS(d.d)))
		LIMIT 1
	) fb ON TRUE
	LEFT JOIN thing_identifier ti ON ti.r_thing_id = fb.id
	LEFT JOIN section s ON ti.r_section_id = s.id
	    AND s.r_section_type_id > 0
	    AND s.r_section_status_id IN (2, 3)
	WHERE NOT EXISTS (
		SELECT 1 FROM curated c WHERE c.bucket_day = d.d
	)

	ORDER BY bucketDate, kind DESC, finishDate DESC, id, sectionId;
`;
