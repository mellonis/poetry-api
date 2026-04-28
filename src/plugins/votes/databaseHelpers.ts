import type { MySQLPromisePool, MySQLRowDataPacket } from '@fastify/mysql';
import { withConnection } from '../../lib/databaseHelpers.js';
import { thingDisplayTitle } from '../../lib/mappers.js';
import { dbToVoteValue } from '../../lib/voteValue.js';
import type { VoteSummary } from '../../lib/voteValue.js';
import {
	upsertVoteQuery,
	deleteVoteQuery,
	voteSummariesQuery,
	voteSummariesBySectionQuery,
	thingTitleQuery,
} from './queries.js';

export const upsertVote = async (mysql: MySQLPromisePool, thingId: number, userId: number, vote: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(upsertVoteQuery, [thingId, userId, vote]);
	});
};

export const deleteVote = async (mysql: MySQLPromisePool, thingId: number, userId: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(deleteVoteQuery, [thingId, userId]);
	});
};

export const getVoteSummaries = async (
	mysql: MySQLPromisePool,
	thingIds: number[],
	userId: number,
): Promise<Record<string, VoteSummary>> => {
	if (thingIds.length === 0) return {};

	return withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(
			voteSummariesQuery(thingIds.length),
			[userId, ...thingIds],
		);

		// Pre-fill every requested id so callers get a stable shape even for
		// things with zero votes.
		const result: Record<string, VoteSummary> = {};
		for (const id of thingIds) {
			result[String(id)] = { likes: 0, dislikes: 0, userVote: null };
		}

		for (const row of rows) {
			result[String(row.thingId as number)] = {
				likes: Number(row.likes ?? 0),
				dislikes: Number(row.dislikes ?? 0),
				userVote: dbToVoteValue(Number(row.userVote ?? 0)),
			};
		}

		return result;
	});
};

// Single-thing summary — wraps the batch helper so the PUT route gets the
// same `{ likes, dislikes, userVote }` shape callers expect, in one DB query.
export const getVoteSummary = async (
	mysql: MySQLPromisePool,
	thingId: number,
	userId: number,
): Promise<VoteSummary> => {
	const map = await getVoteSummaries(mysql, [thingId], userId);
	return map[String(thingId)];
};

export const getVoteSummariesBySection = async (
	mysql: MySQLPromisePool,
	sectionId: string,
	userId: number,
): Promise<Record<string, VoteSummary>> => {
	return withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(
			voteSummariesBySectionQuery,
			[userId, sectionId],
		);

		const result: Record<string, VoteSummary> = {};
		for (const row of rows) {
			result[String(row.thingId as number)] = {
				likes: Number(row.likes ?? 0),
				dislikes: Number(row.dislikes ?? 0),
				userVote: dbToVoteValue(Number(row.userVote ?? 0)),
			};
		}

		return result;
	});
};

export const getThingTitle = async (mysql: MySQLPromisePool, thingId: number): Promise<string> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(thingTitleQuery, [thingId]);
		const row = rows[0];
		return thingDisplayTitle(row?.title as string | null ?? null, row?.firstLines as string | null ?? null, thingId);
	});
