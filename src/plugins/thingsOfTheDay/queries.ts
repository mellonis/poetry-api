import { thingFields, userVoteField } from '../../lib/queries.js';

const extendedThingFields = `
	${thingFields},
	section_identifier        AS sectionId,
	thing_position_in_section AS position
`;

// Curated ordering: most recent finish_date first, with thing_id as a
// deterministic tiebreaker. The CMS calendar (#134) uses the same ordering
// so the homepage carousel and the editor preview agree row-for-row.
export const thingsForDateQuery = `
	SELECT ${extendedThingFields}
	FROM v_things_info
	JOIN thing ON thing.id = v_things_info.thing_id
	WHERE thing.exclude_from_daily = FALSE
		AND (SUBSTRING(thing_finish_date, 6) = DATE_FORMAT(CURDATE(), '%m-%d')
		     OR (SUBSTRING(thing_finish_date, 6, 2) = DATE_FORMAT(CURDATE(), '%m') AND SUBSTRING(thing_finish_date, 9) = '00'
		         AND CURDATE() = LAST_DAY(CURDATE())))
	-- OR SUBSTRING(thing_finish_date, 6) = '00-00' (YYYY-00-00 means date unknown — excluded until a dedicated flag exists in v_things_info)
	ORDER BY thing_finish_date DESC, thing_id;
`;

export const thingsForDateWithUserVoteQuery = `
	SELECT ${extendedThingFields},
	${userVoteField}
	FROM v_things_info
	JOIN thing ON thing.id = v_things_info.thing_id
	WHERE thing.exclude_from_daily = FALSE
		AND (SUBSTRING(thing_finish_date, 6) = DATE_FORMAT(CURDATE(), '%m-%d')
		     OR (SUBSTRING(thing_finish_date, 6, 2) = DATE_FORMAT(CURDATE(), '%m') AND SUBSTRING(thing_finish_date, 9) = '00'
		         AND CURDATE() = LAST_DAY(CURDATE())))
	ORDER BY thing_finish_date DESC, thing_id;
`;

export const thingsOfTheDayFallbackQuery = `
	SELECT ${extendedThingFields}
	FROM v_things_info
	JOIN (
		SELECT id
		FROM thing
		WHERE exclude_from_daily = FALSE
			AND SUBSTRING(finish_date, 6, 2) != DATE_FORMAT(CURDATE(), '%m')
		-- Row-dependent hash, not RAND(constant): the optimizer collapses the latter to scan order.
		ORDER BY MD5(CONCAT(id, ':', TO_DAYS(CURDATE())))
		LIMIT 1
	) AS chosen ON v_things_info.thing_id = chosen.id;
`;

export const thingsOfTheDayFallbackWithUserVoteQuery = `
	SELECT ${extendedThingFields},
	${userVoteField}
	FROM v_things_info
	JOIN (
		SELECT id
		FROM thing
		WHERE exclude_from_daily = FALSE
			AND SUBSTRING(finish_date, 6, 2) != DATE_FORMAT(CURDATE(), '%m')
		-- See thingsOfTheDayFallbackQuery for why the ordering is hash-based, not RAND(seed).
		ORDER BY MD5(CONCAT(id, ':', TO_DAYS(CURDATE())))
		LIMIT 1
	) AS chosen ON v_things_info.thing_id = chosen.id;
`;
