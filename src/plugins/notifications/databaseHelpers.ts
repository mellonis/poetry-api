import type { MySQLPromisePool, MySQLRowDataPacket, MySQLResultSetHeader } from '@fastify/mysql';
import { withConnection } from '../../lib/databaseHelpers.js';
import { encodeCursor, decodeCursor } from '../../lib/cursor.js';
import {
	countUnreadQuery,
	listNotificationsBaseQuery,
	markReadQuery,
	markAllReadQuery,
	deleteNotificationQuery,
} from './queries.js';
import {
	DEFAULT_LIMIT,
	MAX_LIMIT,
	type NotificationItem,
} from './schemas.js';

interface ListParams {
	cursor?: string;
	limit?: number;
	unreadOnly?: boolean;
}

interface ListResult {
	items: NotificationItem[];
	nextCursor: string | null;
}

interface RawNotificationRow {
	id: number;
	typeId: number;
	typeCode: 'comment_reply' | 'comment_vote';
	eventCount: number | string;
	isRead: number;
	createdAt: Date;
	updatedAt: Date;
	subjectId: number;
	subjectText: string;
	threadCommentId: number;
	subjectThingId: number | null;
	objectId: number | null;
	objectText: string | null;
	objectAuthorUserId: number | null;
	objectAuthorDisplayName: string | null;
	sectionIdentifier: string | null;
	positionInSection: number | null;
}

const SITE_AUTHOR_USER_ID = Number(process.env.SITE_AUTHOR_USER_ID) || 1;

const toIso = (d: Date | string): string =>
	d instanceof Date ? d.toISOString() : new Date(d).toISOString();

const projectRow = (row: RawNotificationRow): NotificationItem => ({
	id: row.id,
	type: row.typeCode,
	eventCount: Number(row.eventCount),
	isRead: row.isRead === 1,
	createdAt: toIso(row.createdAt),
	updatedAt: toIso(row.updatedAt),
	subjectComment: {
		id: row.subjectId,
		text: row.subjectText,
		threadCommentId: row.threadCommentId,
		thingId: row.subjectThingId,
		sectionIdentifier: row.sectionIdentifier,
		positionInSection: row.positionInSection,
	},
	objectComment: row.typeCode === 'comment_reply' && row.objectId !== null
		? {
			id: row.objectId,
			text: row.objectText ?? '',
			authorDisplayName: row.objectAuthorDisplayName,
			authorIsAuthor: row.objectAuthorUserId === SITE_AUTHOR_USER_ID,
		}
		: null,
});

export const countUnread = async (mysql: MySQLPromisePool, userId: number): Promise<number> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(countUnreadQuery, [userId]);
		return Number(rows[0]?.cnt ?? 0);
	});

export const listNotifications = async (
	mysql: MySQLPromisePool,
	userId: number,
	params: ListParams,
): Promise<ListResult> => {
	const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
	const unreadFilter = params.unreadOnly ? 'AND n.is_read = 0' : '';

	const decoded = params.cursor ? decodeCursor(params.cursor) : null;
	const cursorFilter = decoded
		? 'AND (n.updated_at < FROM_UNIXTIME(? / 1000) OR (n.updated_at = FROM_UNIXTIME(? / 1000) AND n.id < ?))'
		: '';
	const cursorBindings = decoded ? [decoded.updatedAtMs, decoded.updatedAtMs, decoded.id] : [];

	const sql = listNotificationsBaseQuery
		.replace('{{UNREAD_FILTER}}', unreadFilter)
		.replace('{{CURSOR_FILTER}}', cursorFilter);

	const bindings = [userId, ...cursorBindings, limit + 1];

	return withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(sql, bindings);
		const projected = (rows as unknown as RawNotificationRow[]).map(projectRow);

		const hasMore = projected.length > limit;
		const items = hasMore ? projected.slice(0, limit) : projected;
		const last = items[items.length - 1];
		const nextCursor = hasMore && last
			? encodeCursor(new Date(last.updatedAt), last.id)
			: null;

		return { items, nextCursor };
	});
};

export const markRead = async (
	mysql: MySQLPromisePool,
	notificationId: number,
	userId: number,
): Promise<boolean> =>
	withConnection(mysql, async (connection) => {
		const [result] = await connection.query<MySQLResultSetHeader>(markReadQuery, [notificationId, userId]);
		return result.affectedRows > 0;
	});

export const markAllRead = async (mysql: MySQLPromisePool, userId: number): Promise<number> =>
	withConnection(mysql, async (connection) => {
		const [result] = await connection.query<MySQLResultSetHeader>(markAllReadQuery, [userId]);
		return result.affectedRows;
	});

export const deleteNotification = async (
	mysql: MySQLPromisePool,
	notificationId: number,
	userId: number,
): Promise<boolean> =>
	withConnection(mysql, async (connection) => {
		const [result] = await connection.query<MySQLResultSetHeader>(deleteNotificationQuery, [notificationId, userId]);
		return result.affectedRows > 0;
	});
