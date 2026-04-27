import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errorResponse } from '../../lib/schemas.js';
import { authErrorResponse } from '../auth/schemas.js';
import { requireCanEditContent } from './hooks.js';
import {
	getCommentMeta,
	setCommentStatus,
	hardDeleteComment,
	listCommentsForCms,
} from '../comments/databaseHelpers.js';
import {
	commentParams,
	cmsCommentListQuery,
	cmsCommentListResponse,
	okResponse,
	COMMENT_STATUS,
	type CommentParams,
	type CmsCommentListQuery,
} from '../comments/schemas.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const errorBody = (code: string, message?: string) => ({ error: code, ...(message ? { message } : {}) });

const STATUS_NAME_TO_ID: Record<string, number> = {
	visible: COMMENT_STATUS.visible,
	hidden: COMMENT_STATUS.hidden,
	deleted: COMMENT_STATUS.deleted,
};

export async function commentsCmsRoutes(fastify: FastifyInstance) {
	fastify.get('/comments', {
		schema: {
			description: 'Moderation feed of comments. Filter by status, scope, thingId, userId, or status=reported.',
			tags: ['CMS'],
			querystring: cmsCommentListQuery,
			response: {
				200: cmsCommentListResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		preHandler: requireCanEditContent,
		handler: async (request: FastifyRequest<{ Querystring: CmsCommentListQuery }>) => {
			const { status, scope, thingId, userId, limit, offset } = request.query;
			const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
			const effectiveOffset = offset ?? 0;

			const result = await listCommentsForCms(fastify.mysql, {
				statusId: status && status !== 'reported' ? STATUS_NAME_TO_ID[status] : undefined,
				onlyReported: status === 'reported' || undefined,
				scopeFilter: scope,
				thingId,
				userId,
				limit: effectiveLimit,
				offset: effectiveOffset,
			});

			return {
				items: result.items,
				total: result.total,
				hasMore: result.items.length === effectiveLimit,
			};
		},
	});

	fastify.post('/comments/:commentId/hide', {
		schema: {
			description: 'Mark a comment as hidden by a moderator (status=2). Resolves any open reports against it.',
			tags: ['CMS'],
			params: commentParams,
			response: {
				200: okResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		preHandler: requireCanEditContent,
		handler: async (request: FastifyRequest<{ Params: CommentParams }>, reply) => {
			const userId = request.user!.sub;
			const { commentId } = request.params;
			const meta = await getCommentMeta(fastify.mysql, commentId);
			if (!meta) return reply.code(404).send(errorBody('not_found'));

			await setCommentStatus(fastify.mysql, commentId, COMMENT_STATUS.hidden, userId);
			request.log.info({ commentId, modUserId: userId }, 'Comment hidden by mod');
			return { ok: true as const };
		},
	});

	fastify.post('/comments/:commentId/delete', {
		schema: {
			description: 'Soft-delete a comment as a moderator (status=3). Same outcome label as a self-delete.',
			tags: ['CMS'],
			params: commentParams,
			response: {
				200: okResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		preHandler: requireCanEditContent,
		handler: async (request: FastifyRequest<{ Params: CommentParams }>, reply) => {
			const userId = request.user!.sub;
			const { commentId } = request.params;
			const meta = await getCommentMeta(fastify.mysql, commentId);
			if (!meta) return reply.code(404).send(errorBody('not_found'));

			await setCommentStatus(fastify.mysql, commentId, COMMENT_STATUS.deleted, userId);
			request.log.info({ commentId, modUserId: userId }, 'Comment soft-deleted by mod');
			return { ok: true as const };
		},
	});

	fastify.post('/comments/:commentId/restore', {
		schema: {
			description: 'Restore a hidden or deleted comment back to visible (status=1).',
			tags: ['CMS'],
			params: commentParams,
			response: {
				200: okResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		preHandler: requireCanEditContent,
		handler: async (request: FastifyRequest<{ Params: CommentParams }>, reply) => {
			const userId = request.user!.sub;
			const { commentId } = request.params;
			const meta = await getCommentMeta(fastify.mysql, commentId);
			if (!meta) return reply.code(404).send(errorBody('not_found'));

			await setCommentStatus(fastify.mysql, commentId, COMMENT_STATUS.visible, userId);
			request.log.info({ commentId, modUserId: userId }, 'Comment restored by mod');
			return { ok: true as const };
		},
	});

	fastify.delete('/comments/:commentId', {
		schema: {
			description: 'Hard-delete a comment row. Cascades to replies, votes, and reports. Use sparingly — soft-delete is preferred.',
			tags: ['CMS'],
			params: commentParams,
			response: {
				200: okResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		preHandler: requireCanEditContent,
		handler: async (request: FastifyRequest<{ Params: CommentParams }>, reply) => {
			const userId = request.user!.sub;
			const { commentId } = request.params;
			const meta = await getCommentMeta(fastify.mysql, commentId);
			if (!meta) return reply.code(404).send(errorBody('not_found'));

			await hardDeleteComment(fastify.mysql, commentId);
			request.log.warn({ commentId, modUserId: userId }, 'Comment hard-deleted by mod');
			return { ok: true as const };
		},
	});
}
