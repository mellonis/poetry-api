import type { MySQLPromisePool, MySQLRowDataPacket, MySQLResultSetHeader } from '@fastify/mysql';
import { withConnection } from '../../lib/databaseHelpers.js';
import { isBanned } from '../auth/rights.js';
import { dbToVoteValue, type VoteValue } from '../../lib/voteValue.js';
import {
	topLevelCommentsQuery,
	repliesByParentIdsQuery,
	repliesByParentIdQuery,
	topLevelCommentCountQuery,
	commentByIdQuery,
	commentMetaByIdQuery,
	commentReplyContextQuery,
	insertCommentQuery,
	updateCommentTextQuery,
	setCommentStatusQuery,
	hardDeleteCommentQuery,
	upsertCommentVoteQuery,
	deleteCommentVoteQuery,
	commentVoteCountsQuery,
	userCommentVoteQuery,
	upsertCommentReportQuery,
	resolveReportsForCommentQuery,
	buildCmsCommentListQuery,
} from './queries.js';
import { COMMENT_STATUS, type CommentBase, type CommentWithReplies } from './schemas.js';

export interface CommentMeta {
	id: number;
	userId: number | null;
	thingId: number | null;
	parentId: number | null;
	statusId: number;
	createdAt: Date;
}

interface RawCommentRow {
	id: number;
	parentId: number | null;
	thingId: number | null;
	userId: number | null;
	authorLogin: string | null;
	text: string;
	statusId: number;
	createdAt: Date;
	updatedAt: Date;
	likes: number | string;
	dislikes: number | string;
	userVote: number | string;
	hasVisibleChild?: number;
}

const toIso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const toInt = (v: number | string): number => (typeof v === 'string' ? parseInt(v, 10) : v);

// Tombstones (status 2/3): hide text, author and votes. Caller decides whether
// to include them at all (by hasVisibleChild for top-level, never for replies).
const projectRow = (row: RawCommentRow): CommentBase => {
	const isVisible = row.statusId === COMMENT_STATUS.visible;
	return {
		id: row.id,
		parentId: row.parentId,
		thingId: row.thingId,
		userId: isVisible ? row.userId : null,
		authorLogin: isVisible ? row.authorLogin : null,
		text: isVisible ? row.text : null,
		statusId: row.statusId,
		createdAt: toIso(row.createdAt),
		updatedAt: toIso(row.updatedAt),
		votes: {
			likes: isVisible ? toInt(row.likes) : 0,
			dislikes: isVisible ? toInt(row.dislikes) : 0,
		},
		userVote: isVisible ? dbToVoteValue(toInt(row.userVote)) : null,
	};
};

export interface ListCommentsArgs {
	thingId: number | null;
	userId: number;
	limit: number;
	offset: number;
}

export interface ListCommentsResult {
	items: CommentWithReplies[];
	total: number;
	hasMore: boolean;
}

export const listComments = async (
	mysql: MySQLPromisePool,
	{ thingId, userId, limit, offset }: ListCommentsArgs,
): Promise<ListCommentsResult> =>
	withConnection(mysql, async (connection) => {
		const [topRows] = await connection.query<MySQLRowDataPacket[]>(
			topLevelCommentsQuery,
			[userId, thingId, limit, offset],
		);
		const [countRows] = await connection.query<MySQLRowDataPacket[]>(
			topLevelCommentCountQuery,
			[thingId],
		);

		const total = toInt(countRows[0]?.total as number | string ?? 0);

		// Drop tombstone top-level rows that have no visible children — they'd
		// just be empty placeholders.
		const keptTop = (topRows as unknown as (RawCommentRow & { hasVisibleChild: number })[]).filter(
			(r) => r.statusId === COMMENT_STATUS.visible || r.hasVisibleChild === 1,
		);

		if (keptTop.length === 0) {
			return { items: [], total, hasMore: topRows.length === limit };
		}

		const topIds = keptTop.map((r) => r.id);

		// Two `?` in this query: the userId in the userVote SUM (inherited from
		// commentRowFields) and the IN-list for parent ids. mysql2 expands an
		// array argument to a comma-separated value list for IN (?).
		const [replyRows] = await connection.query<MySQLRowDataPacket[]>(
			repliesByParentIdsQuery,
			[userId, topIds],
		);

		const repliesByParent = new Map<number, CommentBase[]>();
		for (const raw of replyRows as unknown as RawCommentRow[]) {
			// One-level threading: replies can't have descendants, so any non-visible
			// reply is omitted entirely (no tombstone).
			if (raw.statusId !== COMMENT_STATUS.visible) continue;
			const projected = projectRow(raw);
			const list = repliesByParent.get(raw.parentId!) ?? [];
			list.push(projected);
			repliesByParent.set(raw.parentId!, list);
		}

		const items: CommentWithReplies[] = keptTop.map((raw) => ({
			...projectRow(raw),
			replies: repliesByParent.get(raw.id) ?? [],
		}));

		return {
			items,
			total,
			hasMore: topRows.length === limit,
		};
	});

export const getCommentById = async (
	mysql: MySQLPromisePool,
	commentId: number,
	userId: number,
): Promise<CommentBase | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(commentByIdQuery, [userId, commentId]);
		const row = rows[0] as unknown as (RawCommentRow & { hasVisibleChild: number }) | undefined;
		if (!row) return null;
		if (row.statusId !== COMMENT_STATUS.visible && row.hasVisibleChild !== 1) return null;
		return projectRow(row);
	});

// Fetch all visible replies for a top-level comment. Replies that are not
// Visible (status 2/3) are omitted entirely — one-level threading means they
// can't have descendants, so a tombstone reply would be a dead placeholder.
export const getRepliesForTopLevel = async (
	mysql: MySQLPromisePool,
	parentId: number,
	userId: number,
): Promise<CommentBase[]> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(repliesByParentIdQuery, [userId, parentId]);
		return (rows as unknown as RawCommentRow[])
			.filter((r) => r.statusId === COMMENT_STATUS.visible)
			.map(projectRow);
	});

export interface CommentReplyContext {
	parentAuthor:
		| {
			userId: number;
			login: string;
			email: string;
			isBanned: boolean;
		}
		| null;
	thingId: number | null;
	sectionIdentifier: string | null;
	positionInSection: number | null;
}

// Returns the parent comment's author info (for the email recipient) and the
// section/position needed to construct a deep link. Returns null parentAuthor
// when the parent's author was deleted (r_user_id is NULL).
export const getCommentReplyContext = async (
	mysql: MySQLPromisePool,
	parentCommentId: number,
): Promise<CommentReplyContext | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(commentReplyContextQuery, [parentCommentId]);
		const row = rows[0];
		if (!row) return null;

		const userRights = (row.authorUserRights as number | null) ?? 0;
		const groupRights = (row.authorGroupRights as number | null) ?? 0;
		const banned = isBanned(userRights) || isBanned(groupRights);

		const parentAuthor = row.authorUserId
			? {
				userId: row.authorUserId as number,
				login: row.authorLogin as string,
				email: row.authorEmail as string,
				isBanned: banned,
			}
			: null;

		return {
			parentAuthor,
			thingId: (row.thingId as number | null) ?? null,
			sectionIdentifier: (row.sectionIdentifier as string | null) ?? null,
			positionInSection: (row.positionInSection as number | null) ?? null,
		};
	});

export const getCommentMeta = async (
	mysql: MySQLPromisePool,
	commentId: number,
): Promise<CommentMeta | null> =>
	withConnection(mysql, async (connection) => {
		const [rows] = await connection.query<MySQLRowDataPacket[]>(commentMetaByIdQuery, [commentId]);
		if (!rows[0]) return null;
		const r = rows[0];
		return {
			id: r.id as number,
			userId: r.userId as number | null,
			thingId: r.thingId as number | null,
			parentId: r.parentId as number | null,
			statusId: r.statusId as number,
			createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as string),
		};
	});

export interface CreateCommentArgs {
	userId: number;
	thingId: number | null;
	parentId: number | null;
	text: string;
}

export const createComment = async (
	mysql: MySQLPromisePool,
	{ userId, thingId, parentId, text }: CreateCommentArgs,
): Promise<number> =>
	withConnection(mysql, async (connection) => {
		const [result] = await connection.query<MySQLResultSetHeader>(insertCommentQuery, [
			userId,
			thingId,
			parentId,
			text,
			userId,
		]);
		return result.insertId;
	});

export const updateCommentText = async (
	mysql: MySQLPromisePool,
	commentId: number,
	text: string,
): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(updateCommentTextQuery, [text, commentId]);
	});
};

export const setCommentStatus = async (
	mysql: MySQLPromisePool,
	commentId: number,
	statusId: number,
	actorUserId: number,
): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(setCommentStatusQuery, [statusId, actorUserId, commentId]);
		// When a comment is taken out of visible state by a mod, mark any
		// outstanding reports as resolved by that mod — same effect either way.
		if (statusId !== COMMENT_STATUS.visible) {
			await connection.query(resolveReportsForCommentQuery, [actorUserId, commentId]);
		}
	});
};

export const hardDeleteComment = async (
	mysql: MySQLPromisePool,
	commentId: number,
): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(hardDeleteCommentQuery, [commentId]);
	});
};

export interface CommentVoteCounts {
	likes: number;
	dislikes: number;
}

export const upsertCommentVote = async (
	mysql: MySQLPromisePool,
	commentId: number,
	userId: number,
	vote: 1 | -1,
): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(upsertCommentVoteQuery, [commentId, userId, vote]);
	});
};

export const deleteCommentVote = async (
	mysql: MySQLPromisePool,
	commentId: number,
	userId: number,
): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(deleteCommentVoteQuery, [commentId, userId]);
	});
};

export const getCommentVoteSummary = async (
	mysql: MySQLPromisePool,
	commentId: number,
	userId: number,
): Promise<CommentVoteCounts & { userVote: VoteValue }> =>
	withConnection(mysql, async (connection) => {
		const [counts] = await connection.query<MySQLRowDataPacket[]>(commentVoteCountsQuery, [commentId]);
		const [own] = await connection.query<MySQLRowDataPacket[]>(userCommentVoteQuery, [commentId, userId]);
		return {
			likes: toInt(counts[0]?.likes as number | string ?? 0),
			dislikes: toInt(counts[0]?.dislikes as number | string ?? 0),
			userVote: dbToVoteValue(own[0]?.vote as number | undefined),
		};
	});

export const reportComment = async (
	mysql: MySQLPromisePool,
	commentId: number,
	userId: number,
	reason: string | null,
): Promise<void> => {
	await withConnection(mysql, async (connection) => {
		await connection.query(upsertCommentReportQuery, [commentId, userId, reason]);
	});
};

export interface CmsListArgs {
	statusId?: number;
	scopeFilter?: 'site' | 'thing';
	thingId?: number;
	userId?: number;
	onlyReported?: boolean;
	limit: number;
	offset: number;
}

export const listCommentsForCms = async (
	mysql: MySQLPromisePool,
	args: CmsListArgs,
) =>
	withConnection(mysql, async (connection) => {
		const { list, count } = buildCmsCommentListQuery(args);

		const params: (number | string)[] = [];
		if (args.statusId !== undefined) params.push(args.statusId);
		if (args.thingId !== undefined) params.push(args.thingId);
		if (args.userId !== undefined) params.push(args.userId);

		const [items] = await connection.query<MySQLRowDataPacket[]>(list, [...params, args.limit, args.offset]);
		const [totals] = await connection.query<MySQLRowDataPacket[]>(count, params);

		return {
			items: items.map((r) => ({
				id: r.id as number,
				parentId: r.parentId as number | null,
				thingId: r.thingId as number | null,
				userId: r.userId as number | null,
				authorLogin: r.authorLogin as string | null,
				text: r.text as string,
				statusId: r.statusId as number,
				createdAt: toIso(r.createdAt as Date),
				updatedAt: toIso(r.updatedAt as Date),
				statusChangedAt: toIso(r.statusChangedAt as Date),
				statusChangedByUserId: r.statusChangedByUserId as number | null,
				votes: {
					likes: toInt(r.likes as number | string),
					dislikes: toInt(r.dislikes as number | string),
				},
				reportCount: toInt(r.reportCount as number | string),
			})),
			total: toInt(totals[0]?.total as number | string ?? 0),
		};
	});
