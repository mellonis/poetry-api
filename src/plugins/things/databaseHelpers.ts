import type { MySQLPromisePool, MySQLRowDataPacket } from '@fastify/mysql';
import { withConnection } from '../../lib/databaseHelpers.js';
import { groupByThingId } from '../thingsOfTheDay/databaseHelpers.js';
import { publicThingByIdQuery } from './queries.js';
import type { PublicThing } from './schemas.js';

export const getPublicThing = async (mysql: MySQLPromisePool, thingId: number): Promise<PublicThing | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(publicThingByIdQuery, [thingId]);
		const [thing] = groupByThingId(rows);

		return thing ?? null;
	});
