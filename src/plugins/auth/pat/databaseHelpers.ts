import type { MySQLPromisePool, MySQLResultSetHeader, MySQLRowDataPacket } from '@fastify/mysql';
import { withConnection } from '../../../lib/databaseHelpers.js';
import { scopeFromDb, type PatScope } from './scope.js';
import {
	deleteAllUserPersonalAccessTokensQuery,
	deletePersonalAccessTokenQuery,
	findPersonalAccessTokenWithUserQuery,
	insertPersonalAccessTokenQuery,
	listPersonalAccessTokensQuery,
	touchPersonalAccessTokenQuery,
} from './queries.js';

export interface PersonalAccessTokenRow {
	id: number;
	name: string;
	scope: PatScope;
	createdAt: Date;
	lastUsedAt: Date | null;
}

export interface PersonalAccessTokenWithUserRow {
	tokenId: number;
	scope: PatScope;
	userId: number;
	login: string;
	userRights: number;
	groupId: number;
	groupRights: number;
	tokenVersion: number;
}

const mapTokenRow = (row: MySQLRowDataPacket): PersonalAccessTokenRow => ({
	id: row.id,
	name: row.name,
	scope: scopeFromDb(row.scope),
	createdAt: row.created_at,
	lastUsedAt: row.last_used_at ?? null,
});

const mapTokenWithUserRow = (row: MySQLRowDataPacket): PersonalAccessTokenWithUserRow => ({
	tokenId: row.token_id,
	scope: scopeFromDb(row.scope),
	userId: row.user_id,
	login: row.user_login,
	userRights: row.user_rights,
	groupId: row.group_id,
	groupRights: row.group_rights,
	tokenVersion: row.token_version,
});

export const createPersonalAccessToken = async (
	mysql: MySQLPromisePool,
	userId: number,
	name: string,
	tokenHash: string,
	scopeDb: number,
): Promise<number> =>
	withConnection(mysql, async (connection) => {
		const [result] = await connection.query<MySQLResultSetHeader>(insertPersonalAccessTokenQuery, [userId, name, tokenHash, scopeDb]);
		return result.insertId;
	});

export const listPersonalAccessTokens = async (mysql: MySQLPromisePool, userId: number): Promise<PersonalAccessTokenRow[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(listPersonalAccessTokensQuery, [userId]);
		return rows.map(mapTokenRow);
	});

export const findPersonalAccessTokenWithUser = async (
	mysql: MySQLPromisePool,
	tokenHash: string,
): Promise<PersonalAccessTokenWithUserRow | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(findPersonalAccessTokenWithUserQuery, [tokenHash]);
		return rows.length > 0 ? mapTokenWithUserRow(rows[0]) : null;
	});

export const deletePersonalAccessToken = async (mysql: MySQLPromisePool, tokenId: number, userId: number): Promise<boolean> =>
	withConnection(mysql, async (connection) => {
		const [result] = await connection.query<MySQLResultSetHeader>(deletePersonalAccessTokenQuery, [tokenId, userId]);
		return result.affectedRows > 0;
	});

export const deleteAllUserPersonalAccessTokens = async (mysql: MySQLPromisePool, userId: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(deleteAllUserPersonalAccessTokensQuery, [userId]);
	});
};

export const touchPersonalAccessToken = async (mysql: MySQLPromisePool, tokenId: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(touchPersonalAccessTokenQuery, [tokenId]);
	});
};
