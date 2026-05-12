import type { MySQLPromisePool, MySQLResultSetHeader, MySQLRowDataPacket } from '@fastify/mysql';
import { withConnection } from '../../lib/databaseHelpers.js';
import { dbDateToIso, isoDateToDb } from '../../lib/isoDate.js';
import { parseJSON, splitLines } from '../../lib/mappers.js';
import {
	sectionTypesQuery,
	sectionStatusesQuery,
	cmsSectionsQuery,
	cmsSectionByIdQuery,
	createSectionQuery,
	updateSectionQuery,
	deleteSectionQuery,
	deleteAllThingsInSectionQuery,
	externalRedirectsToSectionQuery,
	updateSectionOrderQuery,
	shiftSectionOrdersQuery,
	maxSectionOrderQuery,
	allSectionRedirectsQuery,
	cmsSectionThingsQuery,
	addThingToSectionQuery,
	maxThingPositionQuery,
	shiftThingPositionsQuery,
	removeThingFromSectionQuery,
	updateThingPositionQuery,
	thingExistsQuery,
	sectionThingIdsQuery,
	allThingsQuery,
	cmsAuthorQuery,
	updateAuthorQuery,
	thingStatusesQuery,
	thingCategoriesQuery,
	cmsThingByIdQuery,
	thingNotesQuery,
	createThingQuery,
	updateThingQuery,
	deleteThingQuery,
	thingInSectionsCountQuery,
	upsertThingSeoQuery,
	deleteThingSeoQuery,
	upsertThingInfoQuery,
	deleteThingInfoQuery,
	insertThingNoteQuery,
	updateThingNoteQuery,
	deleteThingNotesExceptQuery,
	deleteAllThingNotesQuery,
	cmsThingsOfTheDayCalendarQuery,
} from './queries.js';

// --- Settings mapping ---

interface DbSettings { show_all?: boolean; things_order?: number }
interface ApiSettings { showAll: boolean; reverseOrder: boolean }

const dbSettingsToApi = (json: string | null): ApiSettings | null => {
	const parsed = parseJSON(json) as DbSettings | undefined;
	if (!parsed) return null;
	return {
		showAll: parsed.show_all ?? false,
		reverseOrder: (parsed.things_order ?? 1) < 0,
	};
};

const apiSettingsToDb = (settings: ApiSettings | null | undefined): string | null => {
	if (!settings) return null;
	if (!settings.showAll && !settings.reverseOrder) return null;
	const db: DbSettings = {};
	if (settings.showAll) db.show_all = true;
	if (settings.reverseOrder) db.things_order = -1;
	return JSON.stringify(db);
};

// --- Section row mapper ---

export interface CmsSection {
	id: number;
	identifier: string;
	title: string;
	description: string | null;
	annotationText: string | null;
	annotationAuthor: string | null;
	typeId: number;
	statusId: number;
	redirectSectionId: number | null;
	settings: ApiSettings | null;
	order: number;
}

const mapCmsSectionRow = (row: MySQLRowDataPacket): CmsSection => ({
	id: row.id as number,
	identifier: row.identifier as string,
	title: row.title as string,
	description: (row.description as string) ?? null,
	annotationText: (row.annotationText as string) ?? null,
	annotationAuthor: (row.annotationAuthor as string) ?? null,
	typeId: row.typeId as number,
	statusId: row.statusId as number,
	redirectSectionId: (row.redirectSectionId as number) ?? null,
	settings: dbSettingsToApi(row.settings as string | null),
	order: row.order as number,
});

// --- Section types ---

export interface SectionType {
	id: number;
	title: string;
}

export const getSectionTypes = async (mysql: MySQLPromisePool): Promise<SectionType[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(sectionTypesQuery);
		return rows.map((row) => ({ id: row.id as number, title: row.title as string }));
	});

export const getSectionStatuses = async (mysql: MySQLPromisePool): Promise<SectionType[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(sectionStatusesQuery);
		return rows.map((row) => ({ id: row.id as number, title: row.title as string }));
	});

// --- Sections CRUD ---

export const getCmsSections = async (mysql: MySQLPromisePool): Promise<CmsSection[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(cmsSectionsQuery);
		return rows.map(mapCmsSectionRow);
	});

export const getCmsSectionById = async (mysql: MySQLPromisePool, id: number): Promise<CmsSection | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(cmsSectionByIdQuery, [id]);
		return rows.length > 0 ? mapCmsSectionRow(rows[0]) : null;
	});

export const createSection = async (
	mysql: MySQLPromisePool,
	data: { identifier: string; title: string; description: string | null; annotationText: string | null; annotationAuthor: string | null; typeId: number; statusId?: number; redirectSectionId: number | null; settings: ApiSettings | null; order?: number },
): Promise<number> =>
	withConnection(mysql, async (connection) => {
		await connection.beginTransaction();
		try {
			let order: number;

			if (data.order !== undefined) {
				await connection.query(shiftSectionOrdersQuery, [data.order]);
				order = data.order;
			} else {
				const [rows] = await connection.query<MySQLRowDataPacket[]>(maxSectionOrderQuery);
				order = (rows[0].maxOrder as number) + 1;
			}

			const [result] = await connection.query<MySQLResultSetHeader>(createSectionQuery, [
				data.identifier,
				data.title,
				data.description,
				data.annotationText,
				data.annotationAuthor,
				data.typeId,
				data.statusId ?? 1,
				data.redirectSectionId,
				apiSettingsToDb(data.settings),
				order,
			]);

			await connection.commit();
			return result.insertId;
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	});

export const updateSection = async (
	mysql: MySQLPromisePool,
	id: number,
	data: { title?: string; description?: string | null; annotationText?: string | null; annotationAuthor?: string | null; typeId?: number; statusId?: number; redirectSectionId?: number | null; settings?: ApiSettings | null; order?: number },
	current: CmsSection,
): Promise<void> =>
	withConnection(mysql, async (connection) => {
		await connection.beginTransaction();
		try {
			await connection.query(updateSectionQuery, [
				data.title ?? current.title,
				data.description !== undefined ? data.description : current.description,
				data.annotationText !== undefined ? data.annotationText : current.annotationText,
				data.annotationAuthor !== undefined ? data.annotationAuthor : current.annotationAuthor,
				data.typeId ?? current.typeId,
				data.statusId ?? current.statusId,
				data.redirectSectionId !== undefined ? data.redirectSectionId : current.redirectSectionId,
				data.settings !== undefined ? apiSettingsToDb(data.settings) : apiSettingsToDb(current.settings),
				id,
			]);

			if (data.order !== undefined && data.order !== current.order) {
				await connection.query(shiftSectionOrdersQuery, [data.order]);
				await connection.query(updateSectionOrderQuery, [data.order, id]);
			}

			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	});

export interface ExternalRedirect {
	fromSectionId: number;
	fromSectionIdentifier: string;
	fromThingId: number;
}

export const getExternalRedirectsToSection = async (mysql: MySQLPromisePool, sectionId: number): Promise<ExternalRedirect[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(externalRedirectsToSectionQuery, [sectionId, sectionId]);
		return rows.map((r) => ({
			fromSectionId: r.fromSectionId as number,
			fromSectionIdentifier: r.fromSectionIdentifier as string,
			fromThingId: r.fromThingId as number,
		}));
	});

export const deleteSection = async (mysql: MySQLPromisePool, id: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.beginTransaction();
		try {
			await connection.query(deleteAllThingsInSectionQuery, [id]);
			await connection.query(deleteSectionQuery, [id]);
			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	});
};

// --- Redirect loop detection ---

export const hasRedirectLoop = async (mysql: MySQLPromisePool, editedSectionId: number, targetRedirectId: number): Promise<boolean> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(allSectionRedirectsQuery);
		const redirectMap = new Map(rows.map((r) => [r.id as number, r.redirectSectionId as number | null]));

		let current: number | null = targetRedirectId;
		const visited = new Set<number>();

		while (current !== null) {
			if (current === editedSectionId) return true;
			if (visited.has(current)) return false;
			visited.add(current);
			current = redirectMap.get(current) ?? null;
		}

		return false;
	});

// --- Section reorder ---

export const reorderSections = async (mysql: MySQLPromisePool, sectionIds: number[]): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.beginTransaction();
		try {
			for (let i = 0; i < sectionIds.length; i++) {
				await connection.query(updateSectionOrderQuery, [i + 1, sectionIds[i]]);
			}
			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	});
};

// --- Things in section ---

export interface CmsThingItem {
	thingId: number;
	title: string | null;
	firstLines: string[] | null;
}

export interface CmsSectionThing extends CmsThingItem {
	position: number;
}

const mapCmsThingRow = (row: MySQLRowDataPacket): CmsThingItem => ({
	thingId: row.thingId as number,
	title: (row.title as string) ?? null,
	firstLines: row.firstLines
		? splitLines(row.firstLines as string)
		: null,
});

const mapCmsSectionThingRow = (row: MySQLRowDataPacket): CmsSectionThing => ({
	...mapCmsThingRow(row),
	position: row.position as number,
});

export const getCmsThingsInSection = async (mysql: MySQLPromisePool, sectionId: number): Promise<CmsSectionThing[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(cmsSectionThingsQuery, [sectionId]);
		return rows.map(mapCmsSectionThingRow);
	});

export const addThingToSection = async (mysql: MySQLPromisePool, sectionId: number, thingId: number, position?: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.beginTransaction();
		try {
			let pos: number;

			if (position !== undefined) {
				await connection.query(shiftThingPositionsQuery, [sectionId, position]);
				pos = position;
			} else {
				const [rows] = await connection.query<MySQLRowDataPacket[]>(maxThingPositionQuery, [sectionId]);
				pos = (rows[0].maxPosition as number) + 1;
			}

			await connection.query(addThingToSectionQuery, [sectionId, pos, thingId]);
			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	});
};

export const removeThingFromSection = async (mysql: MySQLPromisePool, sectionId: number, thingId: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(removeThingFromSectionQuery, [sectionId, thingId]);
	});
};

export const reorderThingsInSection = async (mysql: MySQLPromisePool, sectionId: number, thingIds: number[]): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.beginTransaction();
		try {
			const offset = 10000;

			// Phase 1: move to high offset to avoid unique constraint conflicts
			for (let i = 0; i < thingIds.length; i++) {
				await connection.query(updateThingPositionQuery, [offset + i + 1, sectionId, thingIds[i]]);
			}

			// Phase 2: set final positions
			for (let i = 0; i < thingIds.length; i++) {
				await connection.query(updateThingPositionQuery, [i + 1, sectionId, thingIds[i]]);
			}

			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	});
};

export const thingExists = async (mysql: MySQLPromisePool, thingId: number): Promise<boolean> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(thingExistsQuery, [thingId]);
		return rows.length > 0;
	});

export const getSectionThingIds = async (mysql: MySQLPromisePool, sectionId: number): Promise<number[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(sectionThingIdsQuery, [sectionId]);
		return rows.map((row) => row.thingId as number);
	});

export const getAllThings = async (mysql: MySQLPromisePool): Promise<CmsThingItem[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(allThingsQuery);
		return rows.map(mapCmsThingRow);
	});

// --- Author ---

export interface CmsAuthor {
	text: string;
	date: string;
	seoDescription?: string;
	seoKeywords?: string;
}

export const getCmsAuthor = async (mysql: MySQLPromisePool): Promise<CmsAuthor | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(cmsAuthorQuery);

		if (rows.length === 0) {
			return null;
		}

		return {
			text: rows[0].text as string,
			date: rows[0].date as string,
			seoDescription: (rows[0].seoDescription as string) ?? undefined,
			seoKeywords: (rows[0].seoKeywords as string) ?? undefined,
		};
	});

export const updateAuthor = async (
	mysql: MySQLPromisePool,
	data: { text: string; date: string; seoDescription: string | null; seoKeywords: string | null },
): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(updateAuthorQuery, [data.date, data.text, data.seoDescription, data.seoKeywords]);
	});
};

// --- Thing CRUD ---

export interface CmsThingNote {
	id: number;
	text: string;
}

export interface CmsThing {
	id: number;
	title: string | null;
	text: string;
	categoryId: number;
	statusId: number;
	startDate: string | null;
	finishDate: string;
	firstLines: string | null;
	firstLinesAutoGenerating: boolean;
	excludeFromDaily: boolean;
	notes: CmsThingNote[];
	seoDescription: string | null;
	seoKeywords: string | null;
	info: string | null;
}

export const getThingStatuses = async (mysql: MySQLPromisePool): Promise<SectionType[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(thingStatusesQuery);
		return rows.map((row) => ({ id: row.id as number, title: row.title as string }));
	});

export const getThingCategories = async (mysql: MySQLPromisePool): Promise<SectionType[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(thingCategoriesQuery);
		return rows.map((row) => ({ id: row.id as number, title: row.title as string }));
	});

export const getCmsThing = async (mysql: MySQLPromisePool, thingId: number): Promise<CmsThing | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(cmsThingByIdQuery, [thingId]);

		if (rows.length === 0) {
			return null;
		}

		const row = rows[0];
		const [noteRows] = await connection.query<MySQLRowDataPacket[]>(thingNotesQuery, [thingId]);

		return {
			id: row.id as number,
			title: (row.title as string) ?? null,
			text: row.text as string,
			categoryId: row.categoryId as number,
			statusId: row.statusId as number,
			startDate: row.startDate ? dbDateToIso(row.startDate as string) : null,
			finishDate: dbDateToIso(row.finishDate as string),
			firstLines: (row.firstLines as string) ?? null,
			firstLinesAutoGenerating: Boolean(row.firstLinesAutoGenerating),
			excludeFromDaily: Boolean(row.excludeFromDaily),
			notes: noteRows.map((n) => ({ id: n.id as number, text: n.text as string })),
			seoDescription: (row.seoDescription as string) ?? null,
			seoKeywords: (row.seoKeywords as string) ?? null,
			info: (row.info as string) ?? null,
		};
	});

export const createThing = async (
	mysql: MySQLPromisePool,
	data: {
		title: string | null; text: string; categoryId: number; statusId: number;
		startDate: string | null; finishDate: string;
		firstLines: string | null; firstLinesAutoGenerating: boolean; excludeFromDaily: boolean;
		notes: { text: string }[];
		seoDescription: string | null; seoKeywords: string | null; info: string | null;
	},
): Promise<number> =>
	withConnection(mysql, async (connection) => {
		await connection.beginTransaction();
		try {
			const [result] = await connection.query<MySQLResultSetHeader>(createThingQuery, [
				data.title, data.text, data.categoryId, data.statusId,
				data.startDate ? isoDateToDb(data.startDate) : null,
				isoDateToDb(data.finishDate),
				data.firstLines, data.firstLinesAutoGenerating ? 1 : 0, data.excludeFromDaily ? 1 : 0,
			]);
			const thingId = result.insertId;

			if (data.seoDescription && data.seoKeywords) {
				await connection.query(upsertThingSeoQuery, [thingId, data.seoDescription, data.seoKeywords]);
			}

			if (data.info) {
				await connection.query(upsertThingInfoQuery, [thingId, data.info]);
			}

			for (let i = 0; i < data.notes.length; i++) {
				await connection.query(insertThingNoteQuery, [thingId, data.notes[i].text, i + 1]);
			}

			await connection.commit();
			return thingId;
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	});

export const updateThing = async (
	mysql: MySQLPromisePool,
	thingId: number,
	data: {
		title?: string | null; text?: string; categoryId?: number; statusId?: number;
		startDate?: string | null; finishDate?: string;
		firstLines?: string | null; firstLinesAutoGenerating?: boolean; excludeFromDaily?: boolean;
		notes?: { id?: number; text: string }[];
		seoDescription?: string | null; seoKeywords?: string | null; info?: string | null;
	},
	current: CmsThing,
): Promise<void> =>
	withConnection(mysql, async (connection) => {
		await connection.beginTransaction();
		try {
			const nextStart = data.startDate !== undefined ? data.startDate : current.startDate;
			const nextFinish = data.finishDate ?? current.finishDate;
			await connection.query(updateThingQuery, [
				data.title ?? current.title,
				data.text ?? current.text,
				data.categoryId ?? current.categoryId,
				data.statusId ?? current.statusId,
				nextStart ? isoDateToDb(nextStart) : null,
				isoDateToDb(nextFinish),
				data.firstLines !== undefined ? data.firstLines : current.firstLines,
				(data.firstLinesAutoGenerating ?? current.firstLinesAutoGenerating) ? 1 : 0,
				(data.excludeFromDaily ?? current.excludeFromDaily) ? 1 : 0,
				thingId,
			]);

			// SEO upsert/delete (schema validates both fields are provided together)
			if (data.seoDescription !== undefined || data.seoKeywords !== undefined) {
				const desc = data.seoDescription !== undefined ? data.seoDescription : current.seoDescription;
				const kw = data.seoKeywords !== undefined ? data.seoKeywords : current.seoKeywords;

				if (desc && kw) {
					await connection.query(upsertThingSeoQuery, [thingId, desc, kw]);
				} else {
					await connection.query(deleteThingSeoQuery, [thingId]);
				}
			}

			// Info upsert/delete
			if (data.info !== undefined) {
				if (data.info) {
					await connection.query(upsertThingInfoQuery, [thingId, data.info]);
				} else {
					await connection.query(deleteThingInfoQuery, [thingId]);
				}
			}

			// Notes sync (array position = order)
			if (data.notes !== undefined) {
				const keepIds = data.notes.filter((n) => n.id).map((n) => n.id as number);

				// Delete removed notes first
				if (keepIds.length > 0) {
					await connection.query(deleteThingNotesExceptQuery, [thingId, keepIds]);
				} else {
					await connection.query(deleteAllThingNotesQuery, [thingId]);
				}

				// Then update existing and insert new
				for (let i = 0; i < data.notes.length; i++) {
					const note = data.notes[i];

					if (note.id) {
						await connection.query(updateThingNoteQuery, [note.text, i + 1, note.id, thingId]);
					} else {
						await connection.query(insertThingNoteQuery, [thingId, note.text, i + 1]);
					}
				}
			}

			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	});

export const deleteThing = async (mysql: MySQLPromisePool, thingId: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.beginTransaction();
		try {
			await connection.query(deleteAllThingNotesQuery, [thingId]);
			await connection.query(deleteThingSeoQuery, [thingId]);
			await connection.query(deleteThingInfoQuery, [thingId]);
			await connection.query(deleteThingQuery, [thingId]);
			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	});
};

export const getThingInSectionsCount = async (mysql: MySQLPromisePool, thingId: number): Promise<number> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(thingInSectionsCountQuery, [thingId]);
		return rows[0].cnt as number;
	});

// --- Things-of-the-day calendar ---

export interface CmsCalendarSection {
	id: string;
	position: number;
}

export interface CmsCalendarEntry {
	kind: 'curated' | 'fallback';
	id: number;
	title: string | null;
	firstLines: string | null;
	finishDate: string;
	statusId: number;
	categoryId: number;
	sections: CmsCalendarSection[];
}

export type CmsThingsOfTheDayCalendar = Record<string, CmsCalendarEntry[]>;

// SQL produces one row per (thing, section_placement) pair via LEFT JOINs on
// thing_identifier + section. Multiple rows for the same (kind, id) within
// one bucket are folded into a single entry; their sectionId/position pairs
// accumulate into `sections`. Things with no non-deprecated placements emit
// one row with sectionId=null → entry.sections stays empty.
export const getThingsOfTheDayCalendar = async (
	mysql: MySQLPromisePool,
): Promise<CmsThingsOfTheDayCalendar> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(cmsThingsOfTheDayCalendarQuery);

		const buckets = new Map<string, { order: string[]; entries: Map<string, CmsCalendarEntry> }>();

		for (const row of rows) {
			const bucketDate = row.bucketDate as string;
			let bucket = buckets.get(bucketDate);
			if (!bucket) {
				bucket = { order: [], entries: new Map() };
				buckets.set(bucketDate, bucket);
			}

			const entryKey = `${row.kind as string}:${row.id as number}`;
			let entry = bucket.entries.get(entryKey);
			if (!entry) {
				entry = {
					kind: row.kind as 'curated' | 'fallback',
					id: row.id as number,
					title: (row.title as string) ?? null,
					firstLines: (row.firstLines as string) ?? null,
					finishDate: dbDateToIso(row.finishDate as string),
					statusId: row.statusId as number,
					categoryId: row.categoryId as number,
					sections: [],
				};
				bucket.entries.set(entryKey, entry);
				bucket.order.push(entryKey);
			}

			const sectionId = row.sectionId as string | null;
			if (sectionId !== null && !entry.sections.some((s) => s.id === sectionId)) {
				entry.sections.push({ id: sectionId, position: row.position as number });
			}
		}

		const grouped: CmsThingsOfTheDayCalendar = {};
		for (const [bucketDate, bucket] of buckets) {
			grouped[bucketDate] = bucket.order.map((key) => bucket.entries.get(key)!);
		}

		return grouped;
	});
