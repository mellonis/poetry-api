import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errorResponse } from '../../lib/schemas.js';
import { authErrorResponse } from '../auth/schemas.js';
import { actorFingerprint } from '../../lib/actorFingerprint.js';
import {
	getBookmarks,
	resolveThingId,
	addBookmark,
	removeBookmark,
	reorderBookmarks,
	bulkAddBookmarks,
	type ResolvedThing,
} from './databaseHelpers.js';
import {
	addBookmarkRequest,
	removeBookmarkRequest,
	reorderRequest,
	bulkAddRequest,
	bookmarkResponse,
	type BookmarkItem,
	type ReorderRequest,
	type BulkAddRequest,
} from './schemas.js';

async function resolveOrFail(fastify: FastifyInstance, sectionIdentifier: string, positionInSection: number): Promise<ResolvedThing> {
	const resolved = await resolveThingId(fastify.mysql, sectionIdentifier, positionInSection);

	if (resolved === null) {
		const error = new Error(`Thing not found: ${sectionIdentifier}:${positionInSection}`);
		(error as NodeJS.ErrnoException).code = 'NOT_FOUND';
		throw error;
	}

	return resolved;
}

function isNotFoundError(error: unknown): boolean {
	return error instanceof Error && (error as NodeJS.ErrnoException).code === 'NOT_FOUND';
}

export async function bookmarksPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: bookmarks...');

	fastify.addHook('onRequest', fastify.verifyJwt);

	fastify.get('/', {
		schema: {
			description: 'Get user bookmarks',
			tags: ['Bookmarks'],
			response: {
				200: bookmarkResponse,
				401: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request) => {
			const userId = request.user!.sub;
			return await getBookmarks(fastify.mysql, userId);
		},
	});

	fastify.post('/', {
		schema: {
			description: 'Add a bookmark',
			tags: ['Bookmarks'],
			body: addBookmarkRequest,
			response: {
				200: bookmarkResponse,
				401: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: BookmarkItem }>, reply) => {
			const userId = request.user!.sub;
			const { sectionId, positionInSection } = request.body;

			try {
				const resolved = await resolveOrFail(fastify, sectionId, positionInSection);
				await addBookmark(fastify.mysql, userId, resolved.thingId, resolved.sectionId);
				request.log.info({ actorFingerprint: actorFingerprint(userId), sectionId, positionInSection }, 'Bookmark added');
				return await getBookmarks(fastify.mysql, userId);
			} catch (error) {
				if (isNotFoundError(error)) {
					return reply.code(404).send({ error: (error as Error).message });
				}

				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.delete('/', {
		schema: {
			description: 'Remove a bookmark',
			tags: ['Bookmarks'],
			body: removeBookmarkRequest,
			response: {
				200: bookmarkResponse,
				401: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: BookmarkItem }>, reply) => {
			const userId = request.user!.sub;
			const { sectionId, positionInSection } = request.body;

			try {
				const resolved = await resolveOrFail(fastify, sectionId, positionInSection);
				await removeBookmark(fastify.mysql, userId, resolved.thingId, resolved.sectionId);
				request.log.info({ actorFingerprint: actorFingerprint(userId), sectionId, positionInSection }, 'Bookmark removed');
				return await getBookmarks(fastify.mysql, userId);
			} catch (error) {
				if (isNotFoundError(error)) {
					return reply.code(404).send({ error: (error as Error).message });
				}

				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.put('/order', {
		schema: {
			description: 'Reorder bookmarks',
			tags: ['Bookmarks'],
			body: reorderRequest,
			response: {
				200: bookmarkResponse,
				401: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: ReorderRequest }>, reply) => {
			const userId = request.user!.sub;

			try {
				const items: ResolvedThing[] = [];

				for (const bookmark of request.body.bookmarks) {
					items.push(await resolveOrFail(fastify, bookmark.sectionId, bookmark.positionInSection));
				}

				await reorderBookmarks(fastify.mysql, userId, items);
				request.log.info({ actorFingerprint: actorFingerprint(userId), count: items.length }, 'Bookmarks reordered');
				return await getBookmarks(fastify.mysql, userId);
			} catch (error) {
				if (isNotFoundError(error)) {
					return reply.code(404).send({ error: (error as Error).message });
				}

				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post('/bulk', {
		schema: {
			description: 'Bulk-add bookmarks (for migration from localStorage)',
			tags: ['Bookmarks'],
			body: bulkAddRequest,
			response: {
				200: bookmarkResponse,
				401: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: BulkAddRequest }>, reply) => {
			const userId = request.user!.sub;

			try {
				const items: ResolvedThing[] = [];

				for (const bookmark of request.body.bookmarks) {
					const resolved = await resolveThingId(fastify.mysql, bookmark.sectionId, bookmark.positionInSection);

					if (resolved !== null) {
						items.push(resolved);
					} else {
						request.log.warn({ actorFingerprint: actorFingerprint(userId), sectionId: bookmark.sectionId, positionInSection: bookmark.positionInSection }, 'Bookmark skipped: thing not found');
					}
				}

				if (items.length > 0) {
					await bulkAddBookmarks(fastify.mysql, userId, items);
					request.log.info({ actorFingerprint: actorFingerprint(userId), count: items.length }, 'Bookmarks bulk-added');
				}

				return await getBookmarks(fastify.mysql, userId);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.log.info('[PLUGIN] Registered: bookmarks');
}
