import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errorResponse } from '../../lib/schemas.js';
import { authErrorResponse } from '../auth/schemas.js';
import { sendEmail } from '../../lib/email.js';
import { commentReportedEmail, commentReplyEmail } from '../../lib/emailTemplates.js';
import { sanitizeCommentText } from './sanitizeCommentText.js';
import {
	listComments,
	getCommentById,
	getCommentMeta,
	getRepliesForTopLevel,
	getCommentReplyContext,
	createComment,
	updateCommentText,
	setCommentStatus,
	upsertCommentVote,
	deleteCommentVote,
	getCommentVoteSummary,
	reportComment,
	type CommentReplyContext,
} from './databaseHelpers.js';
import {
	commentParams,
	commentListQuery,
	commentListResponse,
	commentWithRepliesSchema,
	createCommentRequest,
	updateCommentRequest,
	voteCommentRequest,
	voteCommentResponse,
	reportCommentRequest,
	okResponse,
	COMMENT_STATUS,
	COMMENT_EDIT_WINDOW_MS,
	type CommentParams,
	type CommentListQuery,
	type CreateCommentRequest,
	type UpdateCommentRequest,
	type VoteCommentRequest,
	type ReportCommentRequest,
} from './schemas.js';

const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const POST_RATE_LIMIT = { max: 1, timeWindow: '30 seconds' };
const VOTE_RATE_LIMIT = { max: 5, timeWindow: '1 minute' };
const REPORT_RATE_LIMIT = { max: 1, timeWindow: '5 minutes' };

const errorBody = (code: string, message?: string) => ({ error: code, ...(message ? { message } : {}) });

// nextjs is configured without trailing slashes — paths end at the last
// segment, query starts at `?`. Only the bare root `/` keeps its slash.
const buildThreadHref = (siteOrigin: string, ctx: CommentReplyContext, threadCommentId: number): string => {
	if (ctx.thingId === null) {
		return `${siteOrigin}/guestbook?thread=${threadCommentId}`;
	}
	if (!ctx.sectionIdentifier || ctx.positionInSection === null) {
		// Thing has no section row (shouldn't happen for published things) — fall
		// back to the site root so the email still has *some* href.
		return `${siteOrigin}/?thread=${threadCommentId}`;
	}
	return `${siteOrigin}/sections/${encodeURIComponent(ctx.sectionIdentifier)}/${ctx.positionInSection}?thread=${threadCommentId}`;
};

export async function commentsPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: comments...');

	fastify.get('/', {
		schema: {
			description: 'List comments. Filter by thingId for per-thing comments, or scope=site for the guestbook feed.',
			tags: ['Comments'],
			querystring: commentListQuery,
			response: {
				200: commentListResponse,
				400: errorResponse,
				500: errorResponse,
			},
		},
		preHandler: fastify.optionalVerifyJwt,
		handler: async (request: FastifyRequest<{ Querystring: CommentListQuery }>, reply) => {
			const { thingId, scope, limit, offset } = request.query;

			if (thingId !== undefined && scope === 'site') {
				return reply.code(400).send(errorBody('invalid_query', 'Cannot combine thingId with scope=site'));
			}

			const effectiveThingId: number | null = thingId ?? null;
			const userId = request.user?.sub ?? 0;

			return await listComments(fastify.mysql, {
				thingId: effectiveThingId,
				userId,
				limit: Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT),
				offset: offset ?? 0,
			});
		},
	});

	fastify.get('/:commentId', {
		schema: {
			description: 'Fetch a single comment by id. Top-level rows include their replies (single-thread view); reply rows are returned bare.',
			tags: ['Comments'],
			params: commentParams,
			response: {
				200: commentWithRepliesSchema,
				404: errorResponse,
				500: errorResponse,
			},
		},
		preHandler: fastify.optionalVerifyJwt,
		handler: async (request: FastifyRequest<{ Params: CommentParams }>, reply) => {
			const userId = request.user?.sub ?? 0;
			const comment = await getCommentById(fastify.mysql, request.params.commentId, userId);
			if (!comment) return reply.code(404).send(errorBody('not_found'));

			if (comment.parentId === null) {
				const replies = await getRepliesForTopLevel(fastify.mysql, comment.id, userId);
				return { ...comment, replies };
			}

			return comment;
		},
	});

	fastify.post('/', {
		schema: {
			description: 'Post a new comment. thingId omitted = guestbook entry. parentId required for a reply.',
			tags: ['Comments'],
			body: createCommentRequest,
			response: {
				201: commentWithRepliesSchema,
				400: errorResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		config: { rateLimit: POST_RATE_LIMIT },
		preHandler: [fastify.verifyJwt, fastify.requireRight('canComment')],
		handler: async (request: FastifyRequest<{ Body: CreateCommentRequest }>, reply) => {
			const userId = request.user!.sub;
			const { thingId = null, parentId = null, text } = request.body;

			const sanitized = sanitizeCommentText(text);
			if (!sanitized.ok) return reply.code(400).send(errorBody(sanitized.error));

			let resolvedThingId: number | null = thingId;

			if (parentId !== null) {
				const parent = await getCommentMeta(fastify.mysql, parentId);
				if (!parent) return reply.code(404).send(errorBody('parent_not_found'));
				if (parent.parentId !== null) {
					return reply.code(409).send(errorBody('reply_depth_exceeded', 'Replies are limited to one level'));
				}
				if (parent.statusId !== COMMENT_STATUS.visible) {
					return reply.code(409).send(errorBody('parent_not_visible'));
				}
				// Inherit scope from parent — caller's thingId is ignored to keep
				// reply scope consistent with its parent.
				resolvedThingId = parent.thingId;
			}

			const commentId = await createComment(fastify.mysql, {
				userId,
				thingId: resolvedThingId,
				parentId,
				text: sanitized.text,
			});
			request.log.info({ commentId, userId, thingId: resolvedThingId, parentId }, 'Comment created');

			// Reply notification: fire-and-forget. The thread deep link points to
			// the parent (top-level), since pagination is on top-level — opening
			// the parent shows the new reply under it in single-thread mode.
			if (parentId !== null) {
				const ctx = await getCommentReplyContext(fastify.mysql, parentId);
				if (ctx?.parentAuthor && ctx.parentAuthor.userId !== userId && !ctx.parentAuthor.isBanned) {
					const recipient = ctx.parentAuthor;
					const replierLogin = request.user!.login;
					const siteOrigin = fastify.resolveOrigin(request);
					const threadHref = buildThreadHref(siteOrigin, ctx, parentId);
					sendEmail(
						recipient.email,
						commentReplyEmail(siteOrigin, recipient.login, replierLogin, sanitized.text, threadHref),
					).catch((err) => request.log.warn(err, 'Comment-reply notification email failed'));
				}
			}

			const created = await getCommentById(fastify.mysql, commentId, userId);
			return reply.code(201).send(created);
		},
	});

	fastify.put('/:commentId', {
		schema: {
			description: 'Edit own comment within the edit window. Triggers no re-moderation under the post-moderation model.',
			tags: ['Comments'],
			params: commentParams,
			body: updateCommentRequest,
			response: {
				200: commentWithRepliesSchema,
				400: errorResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		preHandler: fastify.verifyJwt,
		handler: async (request: FastifyRequest<{ Params: CommentParams; Body: UpdateCommentRequest }>, reply) => {
			const userId = request.user!.sub;
			const { commentId } = request.params;
			const meta = await getCommentMeta(fastify.mysql, commentId);

			if (!meta) return reply.code(404).send(errorBody('not_found'));
			if (meta.userId !== userId) return reply.code(403).send(errorBody('forbidden'));
			if (meta.statusId !== COMMENT_STATUS.visible) return reply.code(409).send(errorBody('not_editable'));

			const age = Date.now() - meta.createdAt.getTime();
			if (age > COMMENT_EDIT_WINDOW_MS) {
				return reply.code(409).send(errorBody('edit_window_closed'));
			}

			const sanitized = sanitizeCommentText(request.body.text);
			if (!sanitized.ok) return reply.code(400).send(errorBody(sanitized.error));

			await updateCommentText(fastify.mysql, commentId, sanitized.text);
			request.log.info({ commentId, userId }, 'Comment edited');

			return await getCommentById(fastify.mysql, commentId, userId);
		},
	});

	fastify.delete('/:commentId', {
		schema: {
			description: 'Delete own comment (sets status=Deleted). Mods use the CMS routes for moderation actions.',
			tags: ['Comments'],
			params: commentParams,
			response: {
				200: okResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		preHandler: fastify.verifyJwt,
		handler: async (request: FastifyRequest<{ Params: CommentParams }>, reply) => {
			const userId = request.user!.sub;
			const { commentId } = request.params;
			const meta = await getCommentMeta(fastify.mysql, commentId);

			if (!meta) return reply.code(404).send(errorBody('not_found'));
			if (meta.userId !== userId) return reply.code(403).send(errorBody('forbidden'));
			if (meta.statusId !== COMMENT_STATUS.visible) return reply.code(409).send(errorBody('already_removed'));

			await setCommentStatus(fastify.mysql, commentId, COMMENT_STATUS.deleted, userId);
			request.log.info({ commentId, userId }, 'Comment self-deleted');
			return { ok: true as const };
		},
	});

	fastify.put('/:commentId/vote', {
		schema: {
			description: 'Vote on a comment: +1 like, -1 dislike, 0 to remove your vote.',
			tags: ['Comments'],
			params: commentParams,
			body: voteCommentRequest,
			response: {
				200: voteCommentResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		config: { rateLimit: VOTE_RATE_LIMIT },
		preHandler: [fastify.verifyJwt, fastify.requireRight('canVote')],
		handler: async (request: FastifyRequest<{ Params: CommentParams; Body: VoteCommentRequest }>, reply) => {
			const userId = request.user!.sub;
			const { commentId } = request.params;
			const { vote } = request.body;
			const meta = await getCommentMeta(fastify.mysql, commentId);

			if (!meta) return reply.code(404).send(errorBody('not_found'));
			if (meta.statusId !== COMMENT_STATUS.visible) return reply.code(409).send(errorBody('not_votable'));

			if (vote === 0) {
				await deleteCommentVote(fastify.mysql, commentId, userId);
				request.log.info({ commentId, userId }, 'Comment vote removed');
			} else {
				await upsertCommentVote(fastify.mysql, commentId, userId, vote as 1 | -1);
				request.log.info({ commentId, userId, vote }, 'Comment vote recorded');
			}

			return await getCommentVoteSummary(fastify.mysql, commentId, userId);
		},
	});

	fastify.post('/:commentId/report', {
		schema: {
			description: 'Flag a comment as inappropriate. One report per (user, comment); resubmitting overwrites the reason.',
			tags: ['Comments'],
			params: commentParams,
			body: reportCommentRequest,
			response: {
				200: okResponse,
				401: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		config: { rateLimit: REPORT_RATE_LIMIT },
		preHandler: fastify.verifyJwt,
		handler: async (request: FastifyRequest<{ Params: CommentParams; Body: ReportCommentRequest }>, reply) => {
			const userId = request.user!.sub;
			const login = request.user!.login;
			const { commentId } = request.params;
			const { reason } = request.body;
			const meta = await getCommentMeta(fastify.mysql, commentId);

			if (!meta) return reply.code(404).send(errorBody('not_found'));
			if (meta.statusId !== COMMENT_STATUS.visible) return reply.code(409).send(errorBody('not_reportable'));

			await reportComment(fastify.mysql, commentId, userId, reason ?? null);
			request.log.warn({ commentId, userId }, 'Comment reported');

			if (ADMIN_NOTIFY_EMAIL) {
				sendEmail(ADMIN_NOTIFY_EMAIL, commentReportedEmail(login, commentId, reason ?? null))
					.catch((err) => request.log.warn(err, 'Comment-report notification email failed'));
			}

			return { ok: true as const };
		},
	});

	fastify.log.info('[PLUGIN] Registered: comments');
}
