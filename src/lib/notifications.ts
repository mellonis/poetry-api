import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MySQLPromisePool, MySQLRowDataPacket, MySQLResultSetHeader } from '@fastify/mysql';
import { sendEmail } from './email.js';
import { commentReplyEmail, commentVoteEmail } from './emailTemplates.js';
import { actorFingerprint } from './actorFingerprint.js';
import {
	findUnreadVoteBucketQuery,
	incrementVoteBucketQuery,
	insertNotificationQuery,
} from '../plugins/notifications/queries.js';
import { NOTIFICATION_TYPE } from '../plugins/notifications/schemas.js';

interface ReplyRecipient {
	userId: number;
	login: string;
	email: string;
	isBanned: boolean;
	notifyAuthorOnCommentReply: boolean;
}

interface VoteRecipient {
	userId: number;
	login: string;
	email: string;
	isBanned: boolean;
	notifyAuthorOnCommentVote: boolean;
}

interface ReplyPayload {
	recipient: ReplyRecipient;
	parentCommentId: number;
	replyCommentId: number;
	replierDisplayName: string;
	replierIsAuthor: boolean;
	replyText: string;
	siteOrigin: string;
	threadHref: string;
}

interface VotePayload {
	recipient: VoteRecipient;
	commentId: number;
	voteDirection: 1 | -1;
	commentText: string;
	siteOrigin: string;
	threadHref: string;
}

interface InsertReplyArgs {
	recipientUserId: number;
	subjectCommentId: number;
	objectCommentId: number;
}

interface UpsertVoteArgs {
	recipientUserId: number;
	subjectCommentId: number;
}

// Inserts one notification row for a reply event. Returns the new id.
export const insertReplyNotification = async (
	mysql: MySQLPromisePool,
	args: InsertReplyArgs,
): Promise<number> => {
	const connection = await mysql.getConnection();
	try {
		const [result] = await connection.query<MySQLResultSetHeader>(
			insertNotificationQuery,
			[args.recipientUserId, NOTIFICATION_TYPE.commentReply, args.subjectCommentId, args.objectCommentId],
		);
		return result.insertId;
	} finally {
		connection.release();
	}
};

// Vote-bucket upsert: find the recipient's unread bucket for this comment
// and increment, else insert a new row. Runs in a transaction with FOR UPDATE
// on the SELECT so concurrent votes serialize on the bucket row.
export const upsertVoteNotification = async (
	mysql: MySQLPromisePool,
	args: UpsertVoteArgs,
): Promise<number> => {
	const connection = await mysql.getConnection();
	try {
		await connection.beginTransaction();
		try {
			const [rows] = await connection.query<MySQLRowDataPacket[]>(
				findUnreadVoteBucketQuery,
				[args.recipientUserId, args.subjectCommentId],
			);

			let id: number;
			if (rows.length > 0) {
				id = rows[0].id as number;
				await connection.query<MySQLResultSetHeader>(incrementVoteBucketQuery, [id]);
			} else {
				const [result] = await connection.query<MySQLResultSetHeader>(
					insertNotificationQuery,
					[args.recipientUserId, NOTIFICATION_TYPE.commentVote, args.subjectCommentId, null],
				);
				id = result.insertId;
			}

			await connection.commit();
			return id;
		} catch (err) {
			await connection.rollback();
			throw err;
		}
	} finally {
		connection.release();
	}
};

// Fire-and-forget orchestration. The caller has already applied skip rules
// (self-reply, banned recipient, deleted-author). Helpers MUST NOT throw —
// any insert / email failure is logged and swallowed so the underlying
// comment / vote mutation isn't rolled back.
export const notifyCommentReply = (
	fastify: FastifyInstance,
	request: FastifyRequest,
	payload: ReplyPayload,
): void => {
	const { recipient, parentCommentId, replyCommentId } = payload;

	insertReplyNotification(fastify.mysql, {
		recipientUserId: recipient.userId,
		subjectCommentId: parentCommentId,
		objectCommentId: replyCommentId,
	})
		.then((notificationId) => {
			request.log.info(
				{ notificationId, recipientFingerprint: actorFingerprint(recipient.userId), type: 'comment_reply' },
				'Notification created',
			);
		})
		.catch((err) => {
			request.log.warn(err, 'Notification insert failed (comment_reply)');
		});

	if (recipient.notifyAuthorOnCommentReply) {
		sendEmail(
			recipient.email,
			commentReplyEmail(
				payload.siteOrigin,
				recipient.login,
				payload.replierDisplayName,
				payload.replyText,
				payload.threadHref,
				payload.replierIsAuthor,
			),
		).catch((err) => request.log.warn(err, 'Comment-reply notification email failed'));
	}
};

export const notifyCommentVote = (
	fastify: FastifyInstance,
	request: FastifyRequest,
	payload: VotePayload,
): void => {
	const { recipient, commentId, voteDirection } = payload;

	upsertVoteNotification(fastify.mysql, {
		recipientUserId: recipient.userId,
		subjectCommentId: commentId,
	})
		.then((notificationId) => {
			request.log.info(
				{ notificationId, recipientFingerprint: actorFingerprint(recipient.userId), type: 'comment_vote' },
				'Notification upserted',
			);
		})
		.catch((err) => {
			request.log.warn(err, 'Notification upsert failed (comment_vote)');
		});

	if (recipient.notifyAuthorOnCommentVote) {
		sendEmail(
			recipient.email,
			commentVoteEmail(
				payload.siteOrigin,
				recipient.login,
				voteDirection,
				payload.commentText,
				payload.threadHref,
			),
		).catch((err) => request.log.warn(err, 'Comment-vote notification email failed'));
		request.log.info(
			{ commentId, recipientFingerprint: actorFingerprint(recipient.userId) },
			'Comment-vote notification email sent',
		);
	}
};
