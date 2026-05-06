import { z } from 'zod';
import { isValidIsoDate } from '../../lib/isoDate.js';
import { normalizeLegacyInfoJson, normalizeLegacyText } from '../../lib/normalizeLegacyText.js';

// Defensive normalization for legacy text fields rendered via the BBCode-like
// renderer. DB stores canonical chars (em dash, NBSP, en dash, combining acute);
// this guarantees that even when the request bypasses the CMS frontend, the DB
// stays canonical. SEO/keywords/identifier/dates/IDs are intentionally excluded.
const norm = <T extends string | null | undefined>(v: T): T =>
	typeof v === 'string' ? (normalizeLegacyText(v) as T) : v;

const normInfo = <T extends string | null | undefined>(v: T): T =>
	typeof v === 'string' ? (normalizeLegacyInfoJson(v) as T) : v;

// --- Section types reference ---

export const sectionTypeItem = z.object({
	id: z.number().int(),
	title: z.string(),
});

export const sectionTypesResponse = z.array(sectionTypeItem);

// --- CMS section settings ---

export const cmsSectionSettings = z.object({
	showAll: z.boolean(),
	reverseOrder: z.boolean(),
});

// --- CMS section ---

export const cmsSectionItem = z.object({
	id: z.number().int(),
	identifier: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	annotationText: z.string().nullable(),
	annotationAuthor: z.string().nullable(),
	typeId: z.number().int(),
	statusId: z.number().int(),
	redirectSectionId: z.number().int().nullable(),
	settings: cmsSectionSettings.nullable(),
	order: z.number().int(),
});

export const cmsSectionsResponse = z.array(cmsSectionItem);

// --- Section params ---

export const sectionIdParam = z.object({
	sectionId: z.coerce.number().int().positive(),
});

// --- Create section ---

export const createSectionRequest = z.object({
	identifier: z.string().regex(/^[a-z][a-z0-9]{1,6}$/),
	title: z.string().min(1).max(45).transform(norm),
	description: z.string().nullable().default(null).transform(norm),
	annotationText: z.string().nullable().default(null).transform(norm),
	annotationAuthor: z.string().max(100).nullable().default(null).transform(norm),
	typeId: z.number().int().min(1).max(3),
	statusId: z.number().int().min(1).max(4).optional(),
	redirectSectionId: z.number().int().nullable().default(null),
	settings: cmsSectionSettings.nullable().default(null),
	order: z.number().int().positive().optional(),
});

// --- Update section ---

export const updateSectionRequest = z.object({
	title: z.string().min(1).max(45).optional().transform(norm),
	description: z.string().nullable().optional().transform(norm),
	annotationText: z.string().nullable().optional().transform(norm),
	annotationAuthor: z.string().max(100).nullable().optional().transform(norm),
	typeId: z.number().int().min(1).max(3).optional(),
	statusId: z.number().int().min(1).max(4).optional(),
	redirectSectionId: z.number().int().nullable().optional(),
	settings: cmsSectionSettings.nullable().optional(),
	order: z.number().int().positive().optional(),
});

// --- Reorder sections ---

export const reorderSectionsRequest = z.array(z.number().int().positive());

// --- Things in section ---

export const cmsThingItem = z.object({
	thingId: z.number().int(),
	title: z.string().nullable(),
	firstLines: z.array(z.string()).nullable(),
});

export const cmsThingsResponse = z.array(cmsThingItem);

export const cmsSectionThingItem = cmsThingItem.extend({
	position: z.number().int(),
});

export const cmsSectionThingsResponse = z.array(cmsSectionThingItem);

export const thingInSectionParams = z.object({
	sectionId: z.coerce.number().int().positive(),
	thingId: z.coerce.number().int().positive(),
});

// --- Add thing to section ---

export const addThingRequest = z.object({
	thingId: z.number().int().positive(),
	position: z.number().int().positive().optional(),
});

// --- Reorder things in section ---

export const reorderThingsRequest = z.array(z.number().int().positive());

// --- Author ---

export const cmsAuthorResponse = z.object({
	text: z.string(),
	date: z.string(),
	seoDescription: z.optional(z.string()),
	seoKeywords: z.optional(z.string()),
});

export const updateAuthorRequest = z.object({
	text: z.string().min(1).transform(norm),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	seoDescription: z.string().nullable().default(null),
	seoKeywords: z.string().nullable().default(null),
});

// --- Thing CRUD ---

const thingNoteItem = z.object({
	id: z.number().int().optional(),
	text: z.string().min(1).transform(norm),
});

// SEO fields must be provided together or both be null/undefined
const seoFieldsTogether = (d: { seoDescription?: string | null; seoKeywords?: string | null }) => {
	if (d.seoDescription === undefined && d.seoKeywords === undefined) {
		return true;
	}

	return (d.seoDescription == null) === (d.seoKeywords == null);
};
const seoFieldsTogetherMessage = { message: 'seoDescription and seoKeywords must be provided together or both be null' };

// ISO partial date: YYYY (year), YYYY-MM (year-month), YYYY-MM-DD (full).
// Wire format; the cms helpers pad to YYYY-MM-DD with -00 segments before
// inserting into the legacy MySQL DATE columns.
const partialDate = z.string().refine(isValidIsoDate, { message: 'Invalid date' });

export const cmsThingResponse = z.object({
	id: z.number().int(),
	title: z.string().nullable(),
	text: z.string(),
	categoryId: z.number().int(),
	statusId: z.number().int(),
	startDate: z.string().nullable(),
	finishDate: z.string(),
	firstLines: z.string().nullable(),
	firstLinesAutoGenerating: z.boolean(),
	excludeFromDaily: z.boolean(),
	notes: z.array(z.object({ id: z.number().int(), text: z.string() })),
	seoDescription: z.string().nullable(),
	seoKeywords: z.string().nullable(),
	info: z.string().nullable(),
});

export const thingIdParam = z.object({
	thingId: z.coerce.number().int().positive(),
});

export const createThingRequest = z.object({
	title: z.string().nullable().default(null).transform(norm),
	text: z.string().min(1).transform(norm),
	categoryId: z.number().int().min(1).max(4),
	statusId: z.number().int().min(1).max(4).default(1),
	startDate: partialDate.nullable().default(null),
	finishDate: partialDate,
	firstLines: z.string().nullable().default(null).transform(norm),
	firstLinesAutoGenerating: z.literal(false).default(false),
	excludeFromDaily: z.boolean().default(false),
	notes: z.array(thingNoteItem).default([]),
	seoDescription: z.string().nullable().default(null),
	seoKeywords: z.string().nullable().default(null),
	info: z.string().nullable().default(null).transform(normInfo),
}).refine(seoFieldsTogether, seoFieldsTogetherMessage);

export const updateThingRequest = z.object({
	title: z.string().nullable().optional().transform(norm),
	text: z.string().min(1).optional().transform(norm),
	categoryId: z.number().int().min(1).max(4).optional(),
	statusId: z.number().int().min(1).max(4).optional(),
	startDate: partialDate.nullable().optional(),
	finishDate: partialDate.optional(),
	firstLines: z.string().nullable().optional().transform(norm),
	firstLinesAutoGenerating: z.literal(false).optional(),
	excludeFromDaily: z.boolean().optional(),
	notes: z.array(thingNoteItem).optional(),
	seoDescription: z.string().nullable().optional(),
	seoKeywords: z.string().nullable().optional(),
	info: z.string().nullable().optional().transform(normInfo),
}).refine(seoFieldsTogether, seoFieldsTogetherMessage);

// --- Things-of-the-day calendar ---

export const cmsThingsOfTheDayCalendarSection = z.object({
	id: z.string(),
	position: z.number().int(),
});

export const cmsThingsOfTheDayCalendarEntry = z.object({
	kind: z.enum(['curated', 'fallback']),
	id: z.number().int(),
	title: z.string().nullable(),
	firstLines: z.string().nullable(),
	finishDate: z.string().describe(
		'ISO partial date (YYYY | YYYY-MM | YYYY-MM-DD). Fallback rows may carry "0000" when the picked thing is undated.',
	),
	statusId: z.number().int().describe(
		'Thing status (1=Preparing, 2=Published, 3=Editing, 4=Withdrawn). The CMS calendar mirrors the public /things-of-the-day endpoint: only Published (2) and Editing (3) things are returned.',
	),
	categoryId: z.number().int(),
	sections: z.array(cmsThingsOfTheDayCalendarSection).describe(
		'Section placements (id = section.identifier, position = thing_position_in_section). Only non-deprecated, Published-or-Editing section placements appear here — same filter as the public endpoint. A thing with no such placement is excluded from the response entirely.',
	),
});

export const cmsThingsOfTheDayCalendarResponse = z.record(
	z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	z.array(cmsThingsOfTheDayCalendarEntry),
).describe(
	'Rolling 365–366 day window keyed by YYYY-MM-DD, from today through the same date one year minus one day later (e.g. 2026-05-06 → 2027-05-05). Each day has at least one entry: curated rows from things whose finish_date matches that day (full date or month-end for YYYY-MM-00), or a single fallback row deterministically picked from the eligible pool when the curated bucket is empty. Eligibility mirrors the public /things-of-the-day rule (Published/Editing things with at least one non-deprecated, Published/Editing section placement).',
);

// --- Inferred types ---

export type SectionIdParam = z.infer<typeof sectionIdParam>;
export type CreateSectionRequest = z.infer<typeof createSectionRequest>;
export type UpdateSectionRequest = z.infer<typeof updateSectionRequest>;
export type ReorderSectionsRequest = z.infer<typeof reorderSectionsRequest>;
export type ThingInSectionParams = z.infer<typeof thingInSectionParams>;
export type AddThingRequest = z.infer<typeof addThingRequest>;
export type ReorderThingsRequest = z.infer<typeof reorderThingsRequest>;
export type UpdateAuthorRequest = z.infer<typeof updateAuthorRequest>;
export type ThingIdParam = z.infer<typeof thingIdParam>;
export type CreateThingRequest = z.infer<typeof createThingRequest>;
export type UpdateThingRequest = z.infer<typeof updateThingRequest>;
