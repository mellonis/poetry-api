import { z } from 'zod';
import { DATA_NOTICE, type CatalogueRow } from './bridge.js';
import { toolLevelAtLeast, type ToolLevel } from './principal.js';
import { thingSchema } from '../../lib/schemas.js';
import { sectionsResponse } from '../sections/schemas.js';
import { publicThingResponse } from '../things/schemas.js';
import { searchResponse } from '../search/schemas.js';
import { thingsOfTheDayResponse } from '../thingsOfTheDay/schemas.js';
import {
	addThingRequest,
	cmsAuthorResponse,
	cmsSectionItem,
	cmsSectionThingsResponse,
	cmsSectionsResponse,
	cmsThingResponse,
	cmsThingsOfTheDayCalendarResponse,
	cmsThingsResponse,
	createSectionRequest,
	createThingRequest,
	reorderSectionsRequest,
	reorderThingsRequest,
	updateAuthorRequest,
	updateSectionRequest,
	updateThingRequest,
} from '../cms/schemas.js';
import { cmsGroupsResponse, cmsUserResponse, cmsUsersResponse, createUserRequest, updateUserRequest } from '../cms/userSchemas.js';
import { createReservedNameRequest, reservedNameListResponse, reservedNameRow } from '../cms/reservedDisplayNameSchemas.js';
import { cmsCommentListResponse, okResponse } from '../comments/schemas.js';

// Argument schemas are plain (no z.coerce) so the advertised JSON Schema tells
// the model the real type; the route re-validates on its own terms.
const id = z.number().int().positive();
const thingIdArg = z.object({ thingId: id.describe('Thing id') });
const sectionIdArg = z.object({ sectionId: id.describe('Section id (numeric, from cms_list_sections)') });
const thingInSectionArgs = z.object({ sectionId: id, thingId: id });
const commentIdArg = z.object({ commentId: id.describe('Comment id') });
const userIdArg = z.object({ userId: id.describe('User id') });
const reservedNameIdArg = z.object({ id: id.describe('Reserved name id') });
const identifierArg = z.object({ identifier: z.string().min(1).max(64).describe('Section identifier as used in site URLs, e.g. "nnils"') });

const searchArgs = z.object({
	q: z.string().min(1).max(200).describe('Full-text query'),
	limit: z.number().int().min(1).max(50).optional().describe('Default 20'),
	offset: z.number().int().min(0).optional(),
});

const cmsCommentsArgs = z.object({
	status: z.enum(['visible', 'hidden', 'deleted', 'reported']).optional(),
	scope: z.enum(['site', 'thing']).optional().describe('site = guestbook, thing = per-thing comments'),
	thingId: id.optional(),
	userId: id.optional(),
	limit: z.number().int().min(1).max(100).optional(),
	offset: z.number().int().min(0).optional(),
});

const sectionThingSummary = thingSchema.omit({ text: true }).extend({ position: z.number() });
const messageResponse = z.object({ message: z.string() });

const THING_REFERENCE = ' statusId: 1 Preparing, 2 Published, 3 Editing, 4 Withdrawn. categoryId: 1 Poetry, 2 Prose, 3 TLA, 4 Thoughts. Dates are ISO partial: YYYY, YYYY-MM or YYYY-MM-DD. Text uses the site\'s [p]/[q]/[img] markup; type --- for an em dash, [nbsp] for a non-breaking space — the api normalizes on save. `review` is raw Markdown.';
const SECTION_REFERENCE = ' typeId: 1 Normal, 2 Ring, 3 Poetry Collection. statusId: 1 Preparing, 2 Published, 3 Editing, 4 Withdrawn.';
const GROUP_REFERENCE = ' groupId: 1 admins, 2 editors, 3 users. rights is the raw bitmask (see the auth reference).';

const READ = { readOnlyHint: true } as const;
const IDEMPOTENT = { idempotentHint: true } as const;
const DESTRUCTIVE = { destructiveHint: true } as const;

const rows: CatalogueRow[] = [
	// ---- public ----
	{ name: 'list_sections', level: 'public', method: 'GET', path: '/sections', title: 'List sections', annotations: READ,
		description: 'Published sections of the site with type, title, annotation and thing count.', output: sectionsResponse },
	{ name: 'get_section', level: 'public', method: 'GET', path: '/sections/:identifier', title: 'Section contents', annotations: READ,
		description: 'Things of one section in reading order, without their text (use get_thing for a thing\'s text).', params: identifierArg,
		output: z.array(sectionThingSummary),
		mapOutput: (value) => (value as { text?: unknown }[]).map((item) => {
			const rest: Record<string, unknown> = { ...item };
			delete rest.text;
			return rest;
		}) },
	{ name: 'get_thing', level: 'public', method: 'GET', path: '/things/:thingId', title: 'Get thing', annotations: READ,
		description: 'One published thing with its text, notes, dates, votes and every section placement.', params: thingIdArg, output: publicThingResponse },
	{ name: 'search_things', level: 'public', method: 'GET', path: '/search', title: 'Search things', annotations: READ,
		description: 'Full-text search over published things (title, text, notes). Hits carry <mark> highlights and cropped text.', query: searchArgs, output: searchResponse },
	{ name: 'get_things_of_the_day', level: 'public', method: 'GET', path: '/things-of-the-day', title: 'Things of the day', annotations: READ,
		description: 'Today\'s home-page selection: anniversaries of finish dates, or one deterministic fallback.', output: thingsOfTheDayResponse },

	// ---- editor: sections ----
	{ name: 'cms_list_sections', level: 'editor', method: 'GET', path: '/cms/sections', title: 'CMS: list sections', annotations: READ,
		description: 'All sections regardless of status, with numeric ids, settings and annotations.' + SECTION_REFERENCE, output: cmsSectionsResponse },
	{ name: 'cms_create_section', level: 'editor', method: 'POST', path: '/cms/sections', title: 'CMS: create section', annotations: {},
		description: 'Create a section.' + SECTION_REFERENCE, body: createSectionRequest, output: cmsSectionItem },
	{ name: 'cms_update_section', level: 'editor', method: 'PUT', path: '/cms/sections/:sectionId', title: 'CMS: update section', annotations: IDEMPOTENT,
		description: 'Update a section\'s fields; omitted fields are left untouched.' + SECTION_REFERENCE, params: sectionIdArg, body: updateSectionRequest, output: cmsSectionItem },
	{ name: 'cms_delete_section', level: 'editor', method: 'DELETE', path: '/cms/sections/:sectionId', title: 'CMS: delete section', annotations: DESTRUCTIVE,
		description: 'Delete a section and its placements. Refused when other sections redirect into it.', params: sectionIdArg, output: 'none' },
	{ name: 'cms_reorder_sections', level: 'editor', method: 'PUT', path: '/cms/sections/reorder', title: 'CMS: reorder sections', annotations: IDEMPOTENT,
		description: 'Set the order of all sections: the full list of section ids in the wanted order.', body: reorderSectionsRequest, bodyKey: 'ids', output: cmsSectionsResponse },
	{ name: 'cms_list_section_things', level: 'editor', method: 'GET', path: '/cms/sections/:sectionId/things', title: 'CMS: things in section', annotations: READ,
		description: 'Things placed in a section with their positions and editorial status.', params: sectionIdArg, output: cmsSectionThingsResponse },
	{ name: 'cms_add_thing_to_section', level: 'editor', method: 'POST', path: '/cms/sections/:sectionId/things', title: 'CMS: add thing to section', annotations: {},
		description: 'Place a thing in a section, at the end or at a given position.', params: sectionIdArg, body: addThingRequest, output: cmsSectionThingsResponse },
	{ name: 'cms_remove_thing_from_section', level: 'editor', method: 'DELETE', path: '/cms/sections/:sectionId/things/:thingId', title: 'CMS: remove thing from section', annotations: DESTRUCTIVE,
		description: 'Remove a thing\'s placement from a section (the thing itself stays).', params: thingInSectionArgs, output: 'none' },
	{ name: 'cms_reorder_section_things', level: 'editor', method: 'PUT', path: '/cms/sections/:sectionId/things/reorder', title: 'CMS: reorder things in section', annotations: IDEMPOTENT,
		description: 'Set the order of things in a section: the full list of thing ids in the wanted order.', params: sectionIdArg, body: reorderThingsRequest, bodyKey: 'ids', output: cmsSectionThingsResponse },

	// ---- editor: things ----
	{ name: 'cms_list_things', level: 'editor', method: 'GET', path: '/cms/things', title: 'CMS: list things', annotations: READ,
		description: 'Every thing with id, title, first lines, lastModified and editingDoneAt (null = not proofread yet). Use cms_get_thing for status, category, text and the rest.', output: cmsThingsResponse },
	{ name: 'cms_get_thing', level: 'editor', method: 'GET', path: '/cms/things/:thingId', title: 'CMS: get thing for editing', annotations: READ,
		description: 'Full editorial view of a thing: text, notes, SEO, info, review, dates, statuses, editingDoneAt, excludeFromDaily.' + THING_REFERENCE, params: thingIdArg, output: cmsThingResponse },
	{ name: 'cms_create_thing', level: 'editor', method: 'POST', path: '/cms/things', title: 'CMS: create thing', annotations: {},
		description: 'Create a thing (not placed in any section yet).' + THING_REFERENCE, body: createThingRequest, output: cmsThingResponse },
	{ name: 'cms_update_thing', level: 'editor', method: 'PUT', path: '/cms/things/:thingId', title: 'CMS: update thing', annotations: IDEMPOTENT,
		description: 'Update a thing; omitted fields are left untouched. editingDone: true stamps the editorial pass, false clears it, omitted leaves it.' + THING_REFERENCE, params: thingIdArg, body: updateThingRequest, output: cmsThingResponse },
	{ name: 'cms_delete_thing', level: 'editor', method: 'DELETE', path: '/cms/things/:thingId', title: 'CMS: delete thing', annotations: DESTRUCTIVE,
		description: 'Delete a thing. Refused while it is placed in any section.', params: thingIdArg, output: 'none' },
	{ name: 'cms_things_of_the_day_calendar', level: 'editor', method: 'GET', path: '/cms/things-of-the-day/calendar', title: 'CMS: things-of-the-day calendar', annotations: READ,
		description: 'Rolling one-year calendar keyed by YYYY-MM-DD: the things each day will show, with fallback picks for empty days.', output: cmsThingsOfTheDayCalendarResponse },

	// ---- editor: author, reserved names (read), comments, search ----
	{ name: 'cms_get_author', level: 'editor', method: 'GET', path: '/cms/author', title: 'CMS: author page', annotations: READ,
		description: 'The «Об авторе» page text, date and SEO fields for editing.', output: cmsAuthorResponse },
	{ name: 'cms_update_author', level: 'editor', method: 'PUT', path: '/cms/author', title: 'CMS: update author page', annotations: IDEMPOTENT,
		description: 'Replace the «Об авторе» page content (upsert).', body: updateAuthorRequest, output: cmsAuthorResponse },
	{ name: 'cms_list_reserved_names', level: 'editor', method: 'GET', path: '/cms/reserved-display-names', title: 'CMS: reserved display names', annotations: READ,
		description: 'Display names users may not take (admin/mod/system-like terms).', output: reservedNameListResponse },
	{ name: 'cms_list_comments', level: 'editor', method: 'GET', path: '/cms/comments', title: 'CMS: moderation feed', annotations: READ,
		description: 'Comments for moderation with author, status, report count and thing context. status=reported lists open reports first.', query: cmsCommentsArgs, output: cmsCommentListResponse },
	{ name: 'cms_hide_comment', level: 'editor', method: 'POST', path: '/cms/comments/:commentId/hide', title: 'CMS: hide comment', annotations: {},
		description: 'Hide a comment as a moderator (status 2) and resolve its open reports.', params: commentIdArg, output: okResponse },
	{ name: 'cms_delete_comment', level: 'editor', method: 'POST', path: '/cms/comments/:commentId/delete', title: 'CMS: soft-delete comment', annotations: DESTRUCTIVE,
		description: 'Soft-delete a comment as a moderator (status 3); a tombstone keeps the thread shape.', params: commentIdArg, output: okResponse },
	{ name: 'cms_restore_comment', level: 'editor', method: 'POST', path: '/cms/comments/:commentId/restore', title: 'CMS: restore comment', annotations: {},
		description: 'Restore a hidden or deleted comment to visible (status 1).', params: commentIdArg, output: okResponse },
	{ name: 'cms_hard_delete_comment', level: 'editor', method: 'DELETE', path: '/cms/comments/:commentId', title: 'CMS: hard-delete comment', annotations: DESTRUCTIVE,
		description: 'Permanently delete a comment row with its replies, votes and reports. Use sparingly — prefer cms_delete_comment.', params: commentIdArg, output: okResponse },
	{ name: 'cms_reindex_search', level: 'editor', method: 'POST', path: '/cms/search/reindex', title: 'CMS: reindex search', annotations: IDEMPOTENT,
		description: 'Rebuild the full-text search index from the database.', output: z.object({ indexed: z.number().int() }) },

	// ---- admin ----
	{ name: 'admin_list_groups', level: 'admin', method: 'GET', path: '/cms/groups', title: 'Admin: groups', annotations: READ,
		description: 'Auth groups with their rights bitmask.' + GROUP_REFERENCE, output: cmsGroupsResponse },
	{ name: 'admin_list_users', level: 'admin', method: 'GET', path: '/cms/users', title: 'Admin: users', annotations: READ,
		description: 'All accounts with group, rights, activation and ban state; emails are masked.' + GROUP_REFERENCE, output: cmsUsersResponse },
	{ name: 'admin_get_user', level: 'admin', method: 'GET', path: '/cms/users/:userId', title: 'Admin: get user', annotations: READ,
		description: 'One account by id.' + GROUP_REFERENCE, params: userIdArg, output: cmsUserResponse },
	{ name: 'admin_create_user', level: 'admin', method: 'POST', path: '/cms/users', title: 'Admin: create user', annotations: {},
		description: 'Create an account and send its activation email.' + GROUP_REFERENCE, body: createUserRequest, output: cmsUserResponse },
	{ name: 'admin_update_user', level: 'admin', method: 'PUT', path: '/cms/users/:userId', title: 'Admin: update user', annotations: IDEMPOTENT,
		description: 'Change an account\'s group and/or rights bitmask; signs the account out everywhere. Root admin and self-protection rules apply.' + GROUP_REFERENCE, params: userIdArg, body: updateUserRequest, output: cmsUserResponse },
	{ name: 'admin_delete_user', level: 'admin', method: 'DELETE', path: '/cms/users/:userId', title: 'Admin: delete user', annotations: DESTRUCTIVE,
		description: 'Delete an account. Its votes and comments stay, anonymized. Refused for the root admin and for yourself.', params: userIdArg, output: 'none' },
	{ name: 'admin_resend_activation', level: 'admin', method: 'POST', path: '/cms/users/:userId/resend-activation', title: 'Admin: resend activation', annotations: {},
		description: 'Send a fresh activation email to an unactivated account.', params: userIdArg, output: messageResponse },
	{ name: 'admin_reset_user_password', level: 'admin', method: 'POST', path: '/cms/users/:userId/reset-password', title: 'Admin: reset user password', annotations: {},
		description: 'Send a password-reset email to an account.', params: userIdArg, output: messageResponse },
	{ name: 'admin_add_reserved_name', level: 'admin', method: 'POST', path: '/cms/reserved-display-names', title: 'Admin: reserve display name', annotations: {},
		description: 'Add a display name users may not take; compared NFC-normalized and lowercased.', body: createReservedNameRequest, output: reservedNameRow },
	{ name: 'admin_remove_reserved_name', level: 'admin', method: 'DELETE', path: '/cms/reserved-display-names/:id', title: 'Admin: unreserve display name', annotations: DESTRUCTIVE,
		description: 'Remove a reserved display name by id.', params: reservedNameIdArg, output: 'none' },
];

export const CATALOGUE: readonly CatalogueRow[] = rows.map((row) => ({ ...row, description: row.description + DATA_NOTICE }));

export const catalogueForLevel = (level: ToolLevel): CatalogueRow[] =>
	CATALOGUE.filter((row) => toolLevelAtLeast(level, row.level));
