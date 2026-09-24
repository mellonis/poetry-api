import type { MySQLPromisePool, MySQLRowDataPacket } from '@fastify/mysql';
import { withConnection } from '../../lib/databaseHelpers.js';
import { isBanned, isEmailActivated, isPasswordResetRequested } from '../auth/rights.js';
import {
	listGroupsQuery,
	listUsersQuery,
	getUserByIdQuery,
	updateCmsUserQuery,
	deleteCmsUserQuery,
	bumpTokenVersionQuery,
} from './userQueries.js';
import { deleteAllUserRefreshTokensQuery } from '../auth/queries.js';
import { deleteAllUserPersonalAccessTokensQuery } from '../auth/pat/queries.js';

// --- Types ---

export interface CmsGroup {
	id: number;
	title: string;
	rights: number;
}

export interface CmsUser {
	id: number;
	login: string | null;
	email: string | null;
	groupId: number;
	groupTitle: string;
	rights: number;
	lastLogin: string | null;
	isBanned: boolean;
	isEmailActivated: boolean;
	isPasswordResetRequested: boolean;
}

// --- Mappers ---

const mapUserRow = (row: MySQLRowDataPacket): CmsUser => {
	const rights = row.rights as number;

	return {
		id: row.id as number,
		login: (row.login as string) ?? null,
		email: (row.email as string) ?? null,
		groupId: row.groupId as number,
		groupTitle: row.groupTitle as string,
		rights,
		lastLogin: (row.lastLogin as string) ?? null,
		isBanned: isBanned(rights),
		isEmailActivated: isEmailActivated(rights),
		isPasswordResetRequested: isPasswordResetRequested(rights),
	};
};

// --- Groups ---

export const getGroups = async (mysql: MySQLPromisePool): Promise<CmsGroup[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(listGroupsQuery);
		return rows.map((row) => ({
			id: row.id as number,
			title: row.title as string,
			rights: row.rights as number,
		}));
	});

// --- Users CRUD ---

export const getUsers = async (mysql: MySQLPromisePool): Promise<CmsUser[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(listUsersQuery);
		return rows.map(mapUserRow);
	});

export const getUserById = async (mysql: MySQLPromisePool, userId: number): Promise<CmsUser | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(getUserByIdQuery, [userId]);
		return rows.length > 0 ? mapUserRow(rows[0]) : null;
	});

export const updateCmsUser = async (
	mysql: MySQLPromisePool,
	userId: number,
	groupId: number,
	rights: number,
): Promise<void> =>
	withConnection(mysql, async (connection) => {
		await connection.query(updateCmsUserQuery, [groupId, rights, userId]);
	});

export const deleteCmsUser = async (mysql: MySQLPromisePool, userId: number): Promise<void> =>
	withConnection(mysql, async (connection) => {
		await connection.query(deleteCmsUserQuery, [userId]);
	});

export const invalidateUserSessions = async (mysql: MySQLPromisePool, userId: number): Promise<void> =>
	withConnection(mysql, async (connection) => {
		await connection.beginTransaction();
		try {
			await connection.query(bumpTokenVersionQuery, [userId]);
			await connection.query(deleteAllUserRefreshTokensQuery, [userId]);
			await connection.query(deleteAllUserPersonalAccessTokensQuery, [userId]);
			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	});
