import type { MySQLPromisePool, MySQLRowDataPacket } from '@fastify/mysql';
import { thingsForDateQuery, thingsForDateWithUserVoteQuery, thingsOfTheDayFallbackQuery, thingsOfTheDayFallbackWithUserVoteQuery } from './queries.js';
import type { ThingsOfTheDay } from './schemas.js';
import { mapThingBaseRow } from '../../lib/mappers.js';
import { withConnection } from '../../lib/databaseHelpers.js';

export const groupByThingId = (rows: MySQLRowDataPacket[]): ThingsOfTheDay[] => {
	const map = new Map<number, ThingsOfTheDay>();
	const sectionIdSets = new Map<number, Set<string>>();

	for (const row of rows) {
		if (!map.has(row.id)) {
			map.set(row.id, {
				...mapThingBaseRow(row),
				sections: [],
			});

			sectionIdSets.set(row.id, new Set());
		}

		const sectionIdSet = sectionIdSets.get(row.id)!;

		if (!sectionIdSet.has(row.sectionId)) {
			sectionIdSet.add(row.sectionId);
			map.get(row.id)!.sections.push({ id: row.sectionId, position: row.position });
		}
	}

	return Array.from(map.values());
};

export const getThingsOfTheDay = async (mysql: MySQLPromisePool, userId?: number): Promise<ThingsOfTheDay[]> =>
	withConnection(mysql, async (connection) => {
		let [rows] = userId
			? await connection.query<MySQLRowDataPacket[]>(thingsForDateWithUserVoteQuery, [userId])
			: await connection.query<MySQLRowDataPacket[]>(thingsForDateQuery);

		if (rows.length === 0) {
			[rows] = userId
				? await connection.query<MySQLRowDataPacket[]>(thingsOfTheDayFallbackWithUserVoteQuery, [userId])
				: await connection.query<MySQLRowDataPacket[]>(thingsOfTheDayFallbackQuery);
		}

		return groupByThingId(rows);
	});
