import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getSections, getSectionById, getSectionThings } from './databaseHelpers.js';
import { sectionsResponse, thingsRequest, thingsResponse, type ThingsRequest } from './schemas.js';
import { errorResponse } from '../../lib/schemas.js';

export async function sectionsPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: sections...');

	fastify.addHook('onRequest', fastify.optionalVerifyJwt);

	fastify.get('/', {
		schema: {
			description: 'List all sections.',
			tags: ['Sections'],
			response: {
				200: sectionsResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				return await getSections(fastify.mysql);
			} catch (error) {
				request.log.error(error);
				reply.status(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.get('/:identifier', {
		schema: {
			description: 'Get things (poems/prose) in a section by section identifier.',
			tags: ['Sections'],
			params: thingsRequest,
			response: {
				200: thingsResponse,
				404: z.void(),
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: ThingsRequest }>, reply) => {
			try {
				const section = await getSectionById(fastify.mysql, request.params.identifier);

				if (!section) {
					return reply.code(404).send();
				}

				const userId = request.user?.sub;

				return await getSectionThings(fastify.mysql, request.params.identifier, userId);
			} catch (error) {
				request.log.error(error);
				reply.status(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.log.info('[PLUGIN] Registered: sections');
}
