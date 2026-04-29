import type { MySQLRowDataPacket } from '@fastify/mysql';
import type { z } from 'zod';
import type { thingSchema } from './schemas.js';
import { dbDateToIso } from './isoDate.js';
import { dbToVoteValue } from './voteValue.js';

type ThingBase = z.infer<typeof thingSchema>;

export const splitLines = (value: string): string[] =>
	value.replaceAll('\r', '').split('\n');

export const parseJSON = (value: string | null): unknown => {
	if (!value) {
		return undefined;
	}

	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
};

export const thingDisplayTitle = (title: string | null, firstLines: string | null, id: number): string => {
	if (title) {
		return title;
	}

	if (firstLines) {
		return `«${firstLines.split('\n')[0]}…»`;
	}

	return `#${id}`;
};

export const mapThingBaseRow = (row: MySQLRowDataPacket) => ({
	id: row.id as number,
	categoryId: row.categoryId,
	title: row.title ?? undefined as string | undefined,
	firstLines: (row.firstLines ?? undefined) ? splitLines(row.firstLines as string) : undefined,
	startDate: row.startDate ? dbDateToIso(row.startDate as string) : undefined,
	finishDate: dbDateToIso(row.finishDate as string),
	lastModified: row.lastModified ?? undefined as string | undefined,
	text: row.text as string,
	seoDescription: row.seoDescription ?? undefined as string | undefined,
	seoKeywords: row.seoKeywords ?? undefined as string | undefined,
	info: parseJSON(row.info) as ThingBase['info'],
	notes: parseJSON(row.notes) as ThingBase['notes'],
	votes: { likes: row.votesLikes as number, dislikes: row.votesDislikes as number },
	...(row.userVote !== undefined && { userVote: dbToVoteValue(row.userVote as number | null) }),
});
