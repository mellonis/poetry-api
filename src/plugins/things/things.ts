import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errorResponse } from '../../lib/schemas.js';
import { getPublicThing } from './databaseHelpers.js';
import { publicThingResponse, thingIdParams, type ThingIdParams } from './schemas.js';

export async function thingsPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: things...');

	fastify.get<{ Params: ThingIdParams }>('/:thingId', {
		schema: {
			description: 'One published thing by id, with every section placement it appears in.',
			tags: ['Things'],
			params: thingIdParams,
			response: {
				200: publicThingResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: ThingIdParams }>, reply) => {
			try {
				const thing = await getPublicThing(fastify.mysql, request.params.thingId);

				if (!thing) {
					return reply.code(404).send({ error: 'Thing not found' });
				}

				return thing;
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.log.info('[PLUGIN] Registered: things');
}
