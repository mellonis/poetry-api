import { thingFields } from '../../lib/queries.js';

// One row per (thing, section) placement, like things-of-the-day; the app groups
// them. Only Published things (thing_status 2) are public.
export const publicThingByIdQuery = `
	SELECT ${thingFields},
		section_identifier        AS sectionId,
		thing_position_in_section AS position
	FROM v_things_info
	JOIN thing ON thing.id = v_things_info.thing_id
	WHERE thing_id = ? AND thing.r_thing_status_id = 2
	ORDER BY section_identifier, thing_position_in_section;
`;
