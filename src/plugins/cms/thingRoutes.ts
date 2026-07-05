import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../lib/schemas.js';
import { actorFingerprint } from '../../lib/actorFingerprint.js';
import { authErrorResponse } from '../auth/schemas.js';
import {
	getThingStatuses,
	getThingCategories,
	getCmsThing,
	createThing,
	updateThing,
	deleteThing,
	getThingInSectionsCount,
} from './databaseHelpers.js';
import {
	sectionTypesResponse,
	cmsThingResponse,
	thingIdParam,
	createThingRequest,
	updateThingRequest,
	type ThingIdParam,
	type CreateThingRequest,
	type UpdateThingRequest,
} from './schemas.js';
import { requireCanEditContent } from './hooks.js';
import { syncThingToSearch, deleteThingFromSearch } from '../search/searchSync.js';

export async function thingRoutes(fastify: FastifyInstance) {
	fastify.get('/thing-statuses', {
		schema: {
			description: 'List thing statuses.',
			tags: ['CMS'],
			response: {
				200: sectionTypesResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				return await getThingStatuses(fastify.mysql);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.get('/thing-categories', {
		schema: {
			description: 'List thing categories.',
			tags: ['CMS'],
			response: {
				200: sectionTypesResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				return await getThingCategories(fastify.mysql);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.get<{ Params: ThingIdParam }>('/things/:thingId', {
		schema: {
			description: 'Get a thing for editing.',
			tags: ['CMS'],
			params: thingIdParam,
			response: {
				200: cmsThingResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				const thing = await getCmsThing(fastify.mysql, request.params.thingId);

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

	fastify.post('/things', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Create a new thing.',
			tags: ['CMS'],
			body: createThingRequest,
			response: {
				201: cmsThingResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: CreateThingRequest }>, reply) => {
			try {
				const id = await createThing(fastify.mysql, request.body);
				const thing = await getCmsThing(fastify.mysql, id);

				request.log.info({ actorFingerprint: actorFingerprint(request.user!.sub), thingId: id }, 'Thing created');
				if (request.body.editingDone) {
					request.log.info({ actorFingerprint: actorFingerprint(request.user!.sub), thingId: id, editingDone: true }, 'Thing editorial-pass flag set');
				}
				if (fastify.meiliClient) {
					syncThingToSearch(fastify.meiliClient, fastify.mysql, id, request.log)
						.catch((err) => request.log.error(err, 'Meilisearch sync failed'));
				}
				return reply.code(201).send(thing);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.put<{ Params: ThingIdParam; Body: UpdateThingRequest }>('/things/:thingId', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Update a thing.',
			tags: ['CMS'],
			params: thingIdParam,
			body: updateThingRequest,
			response: {
				200: cmsThingResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				const current = await getCmsThing(fastify.mysql, request.params.thingId);

				if (!current) {
					return reply.code(404).send({ error: 'Thing not found' });
				}

				await updateThing(fastify.mysql, request.params.thingId, request.body, current);
				const updated = await getCmsThing(fastify.mysql, request.params.thingId);

				request.log.info({ actorFingerprint: actorFingerprint(request.user!.sub), thingId: request.params.thingId }, 'Thing updated');
				if (request.body.editingDone !== undefined) {
					request.log.info({ actorFingerprint: actorFingerprint(request.user!.sub), thingId: request.params.thingId, editingDone: request.body.editingDone }, 'Thing editorial-pass flag updated');
				}
				if (fastify.meiliClient) {
					syncThingToSearch(fastify.meiliClient, fastify.mysql, request.params.thingId, request.log)
						.catch((err) => request.log.error(err, 'Meilisearch sync failed'));
				}
				return updated;
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.delete<{ Params: ThingIdParam }>('/things/:thingId', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Delete a thing. Refuses if thing is in any section.',
			tags: ['CMS'],
			params: thingIdParam,
			response: {
				204: z.void(),
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				const current = await getCmsThing(fastify.mysql, request.params.thingId);

				if (!current) {
					return reply.code(404).send({ error: 'Thing not found' });
				}

				const sectionCount = await getThingInSectionsCount(fastify.mysql, request.params.thingId);

				if (sectionCount > 0) {
					return reply.code(409).send({ error: 'Thing is in sections — remove it from all sections first' });
				}

				await deleteThing(fastify.mysql, request.params.thingId);
				request.log.info({ thingId: request.params.thingId }, 'Thing deleted');
				if (fastify.meiliClient) {
					deleteThingFromSearch(fastify.meiliClient, request.params.thingId, request.log)
						.catch((err) => request.log.error(err, 'Meilisearch delete failed'));
				}
				return reply.code(204).send();
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});
}
