import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errorResponse } from '../../lib/schemas.js';
import { authErrorResponse } from '../auth/schemas.js';
import { getCmsAuthor, updateAuthor } from './databaseHelpers.js';
import { cmsAuthorResponse, updateAuthorRequest, type UpdateAuthorRequest } from './schemas.js';
import { requireCanEditContent } from './hooks.js';

export async function authorRoutes(fastify: FastifyInstance) {
	fastify.get('/author', {
		schema: {
			description: 'Get author page content for editing.',
			tags: ['CMS'],
			response: {
				200: cmsAuthorResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				const author = await getCmsAuthor(fastify.mysql);

				return author ?? { text: '', date: '' };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.put('/author', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Update author page content.',
			tags: ['CMS'],
			body: updateAuthorRequest,
			response: {
				200: cmsAuthorResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: UpdateAuthorRequest }>, reply) => {
			try {
				await updateAuthor(fastify.mysql, request.body);
				request.log.info('Author page updated');

				const author = await getCmsAuthor(fastify.mysql);

				if (!author) {
					return reply.code(500).send({ error: 'Internal server error' });
				}

				return author;
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});
}
