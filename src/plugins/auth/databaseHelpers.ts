import { createHash, randomBytes } from 'node:crypto';
import type { MySQLPromisePool, MySQLResultSetHeader, MySQLRowDataPacket } from '@fastify/mysql';
import { withConnection } from '../../lib/databaseHelpers.js';
import {
	deleteAllUserRefreshTokensQuery,
	deleteRefreshTokenQuery,
	findRefreshTokenWithUserQuery,
	findUserByKeyQuery,
	findUserByEmailQuery,
	findUserByLoginQuery,
	insertRefreshTokenQuery,
	insertUserQuery,
	loginOrEmailExistsQuery,
	rehashPasswordQuery,
	resetPasswordQuery,
	updateLastLoginQuery,
	updateUserRightsAndKeyQuery,
} from './queries.js';

export interface UserRow {
	userId: number;
	login: string;
	passwordHash: string;
	email: string;
	userRights: number;
	groupId: number;
	groupRights: number;
	tokenVersion: number;
	key: string | null;
}

const mapUserRow = (row: MySQLRowDataPacket): UserRow => ({
	userId: row.user_id,
	login: row.user_login,
	passwordHash: row.user_password,
	email: row.user_email,
	userRights: row.user_rights,
	groupId: row.group_id,
	groupRights: row.group_rights,
	tokenVersion: row.token_version,
	key: row.user_key ?? null,
});

export const findUserByLogin = async (mysql: MySQLPromisePool, login: string): Promise<UserRow | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(findUserByLoginQuery, [login]);
		return rows.length > 0 ? mapUserRow(rows[0]) : null;
	});

export const findUserByEmail = async (mysql: MySQLPromisePool, email: string): Promise<UserRow | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(findUserByEmailQuery, [email]);
		return rows.length > 0 ? mapUserRow(rows[0]) : null;
	});

export const createRefreshToken = async (
	mysql: MySQLPromisePool,
	userId: number,
	tokenHash: string,
): Promise<void> => {
	const ttlInSeconds = Number(process.env.JWT_REFRESH_TOKEN_TTL);

	await withConnection(mysql, async (connection) => {
		await connection.query(insertRefreshTokenQuery, [userId, tokenHash, ttlInSeconds]);
	});
};

export const findAndDeleteRefreshToken = async (
	mysql: MySQLPromisePool,
	tokenHash: string,
): Promise<UserRow | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(findRefreshTokenWithUserQuery, [tokenHash]);

		if (rows.length === 0) {
			return null;
		}

		await connection.query(deleteRefreshTokenQuery, [rows[0].token_id]);

		return mapUserRow(rows[0]);
	});

export const deleteAllUserRefreshTokens = async (mysql: MySQLPromisePool, userId: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(deleteAllUserRefreshTokensQuery, [userId]);
	});
};

export const rehashPassword = async (mysql: MySQLPromisePool, userId: number, newHash: string): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(rehashPasswordQuery, [newHash, userId]);
	});
};

export const updateLastLogin = async (mysql: MySQLPromisePool, userId: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(updateLastLoginQuery, [userId]);
	});
};

const KEY_TIMESTAMP_LENGTH = 8;

export const generateVerificationKey = (): string => {
	const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(KEY_TIMESTAMP_LENGTH, '0');
	const random = randomBytes(12).toString('hex'); // 24 hex chars

	return timestamp + random;
};

// TTL env vars are validated at startup in auth.ts — safe to parse without checks here.
export const isActivationKeyExpired = (key: string): boolean =>
	isKeyOlderThan(key, Number(process.env.ACTIVATION_KEY_TTL));

export const isResetKeyExpired = (key: string): boolean =>
	isKeyOlderThan(key, Number(process.env.RESET_KEY_TTL));

const isKeyOlderThan = (key: string, ttlInSeconds: number): boolean => {
	const timestampHex = key.substring(0, KEY_TIMESTAMP_LENGTH);
	const timestamp = parseInt(timestampHex, 16);
	const now = Math.floor(Date.now() / 1000);

	return now - timestamp > ttlInSeconds;
};

// Verification keys are stored as SHA-256 hashes so a DB leak does not expose
// active activation/reset keys. The raw key is sent in the email link; the API
// hashes it before lookup.
const hashKey = (key: string): string =>
	createHash('sha256').update(key).digest('hex');

const DEFAULT_GROUP_ID = 3;
const DEFAULT_USER_RIGHTS = 24; // canVote (bit 3) + canComment (bit 4)

export const createUser = async (
	mysql: MySQLPromisePool,
	login: string,
	passwordHash: string,
	email: string,
	key: string,
	groupId: number = DEFAULT_GROUP_ID,
	rights: number = DEFAULT_USER_RIGHTS,
): Promise<number> =>
	withConnection(mysql, async (connection) => {
		const [result] = await connection.query<MySQLResultSetHeader>(
			insertUserQuery,
			[groupId, rights, login, passwordHash, email, hashKey(key), login],
		);
		return result.insertId;
	});

export const findUserByKey = async (mysql: MySQLPromisePool, key: string): Promise<UserRow | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(findUserByKeyQuery, [hashKey(key)]);
		return rows.length > 0 ? mapUserRow(rows[0]) : null;
	});

export const updateUserRightsAndKey = async (mysql: MySQLPromisePool, userId: number, rights: number, key: string | null): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		const keyHash = key === null ? null : hashKey(key);
		const keyCreatedAt = key === null ? null : new Date();
		await connection.query(updateUserRightsAndKeyQuery, [rights, keyHash, keyCreatedAt, userId]);
	});
};

export const resetPassword = async (
	mysql: MySQLPromisePool,
	userId: number,
	passwordHash: string,
	rights: number,
): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(resetPasswordQuery, [passwordHash, rights, userId]);
	});
};

export const loginOrEmailExists = async (mysql: MySQLPromisePool, login: string, email: string): Promise<boolean> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(loginOrEmailExistsQuery, [login, email]);
		return rows.length > 0;
	});
