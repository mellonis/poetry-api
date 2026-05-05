import type { MySQLPromisePool, MySQLRowDataPacket } from '@fastify/mysql';
import { withConnection } from '../../lib/databaseHelpers.js';
import { reservedCheckKey } from '../../lib/displayName.js';
import {
	getUserPasswordAndEmailQuery,
	updatePasswordQuery,
	deleteUserQuery,
	getNotificationSettingsQuery,
	updateNotificationSettingsQuery,
	getDisplayNameQuery,
	updateDisplayNameQuery,
	getAllReservedValuesQuery,
} from './queries.js';

export interface UserCredentials {
	passwordHash: string;
	email: string;
}

export const getUserCredentials = async (mysql: MySQLPromisePool, userId: number): Promise<UserCredentials | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(getUserPasswordAndEmailQuery, [userId]);
		return rows.length > 0 ? { passwordHash: rows[0].password_hash, email: rows[0].email } : null;
	});

export const updatePassword = async (mysql: MySQLPromisePool, userId: number, passwordHash: string): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(updatePasswordQuery, [passwordHash, userId]);
	});
};

// Vote anonymization happens via DB-level ON DELETE SET NULL on vote.r_user_id —
// no app-level cleanup needed. Refresh tokens cascade-delete the same way.
export const deleteUser = async (mysql: MySQLPromisePool, userId: number): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(deleteUserQuery, [userId]);
	});
};

export interface NotificationSettings {
	notifyAuthorOnCommentReply: boolean;
	notifyAuthorOnCommentVote: boolean;
}

export const getNotificationSettings = async (
	mysql: MySQLPromisePool,
	userId: number,
): Promise<NotificationSettings | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(getNotificationSettingsQuery, [userId]);
		if (!rows[0]) return null;
		return {
			notifyAuthorOnCommentReply: rows[0].notify_author_on_comment_reply === 1,
			notifyAuthorOnCommentVote: rows[0].notify_author_on_comment_vote === 1,
		};
	});

export const updateNotificationSettings = async (
	mysql: MySQLPromisePool,
	userId: number,
	settings: NotificationSettings,
): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(updateNotificationSettingsQuery, [
			settings.notifyAuthorOnCommentReply ? 1 : 0,
			settings.notifyAuthorOnCommentVote ? 1 : 0,
			userId,
		]);
	});
};

export interface DisplayNameInfo {
	displayName: string | null;
	displayNameChangedAt: Date | null;
}

export const getDisplayName = async (
	mysql: MySQLPromisePool,
	userId: number,
): Promise<DisplayNameInfo | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(getDisplayNameQuery, [userId]);
		if (!rows[0]) return null;
		return {
			displayName: rows[0].displayName ?? null,
			displayNameChangedAt: rows[0].displayNameChangedAt ? new Date(rows[0].displayNameChangedAt) : null,
		};
	});

export const setDisplayName = async (
	mysql: MySQLPromisePool,
	userId: number,
	displayName: string,
): Promise<void> =>
	withConnection(mysql, async (connection) => {
		await connection.query(updateDisplayNameQuery, [displayName, userId]);
	});

export const isReservedDisplayName = async (
	mysql: MySQLPromisePool,
	displayName: string,
): Promise<boolean> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(getAllReservedValuesQuery);
		const checkKey = reservedCheckKey(displayName);
		return (rows as MySQLRowDataPacket[]).some((r) => reservedCheckKey(r.value as string) === checkKey);
	});
