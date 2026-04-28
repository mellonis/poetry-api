import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../lib/schemas.js';
import { authErrorResponse } from '../auth/schemas.js';
import {
	getCmsSectionById,
	getCmsThingsInSection,
	addThingToSection,
	removeThingFromSection,
	reorderThingsInSection,
	thingExists,
	getSectionThingIds,
	getAllThings,
} from './databaseHelpers.js';
import {
	sectionIdParam,
	cmsThingsResponse,
	cmsSectionThingsResponse,
	thingInSectionParams,
	addThingRequest,
	reorderThingsRequest,
	type SectionIdParam,
	type ThingInSectionParams,
	type AddThingRequest,
	type ReorderThingsRequest,
} from './schemas.js';
import { requireCanEditContent } from './hooks.js';

export async function sectionThingRoutes(fastify: FastifyInstance) {
	fastify.get('/things', {
		schema: {
			description: 'List all things.',
			tags: ['CMS'],
			response: {
				200: cmsThingsResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				return await getAllThings(fastify.mysql);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.get<{ Params: SectionIdParam }>('/sections/:sectionId/things', {
		schema: {
			description: 'List things in a section.',
			tags: ['CMS'],
			params: sectionIdParam,
			response: {
				200: cmsSectionThingsResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				const section = await getCmsSectionById(fastify.mysql, request.params.sectionId);

				if (!section) {
					return reply.code(404).send({ error: 'Section not found' });
				}

				return await getCmsThingsInSection(fastify.mysql, request.params.sectionId);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post<{ Params: SectionIdParam; Body: AddThingRequest }>('/sections/:sectionId/things', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Add a thing to a section.',
			tags: ['CMS'],
			params: sectionIdParam,
			body: addThingRequest,
			response: {
				201: cmsSectionThingsResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				const section = await getCmsSectionById(fastify.mysql, request.params.sectionId);

				if (!section) {
					return reply.code(404).send({ error: 'Section not found' });
				}

				const exists = await thingExists(fastify.mysql, request.body.thingId);

				if (!exists) {
					return reply.code(404).send({ error: 'Thing not found' });
				}

				await addThingToSection(fastify.mysql, request.params.sectionId, request.body.thingId, request.body.position);
				request.log.info({ sectionId: request.params.sectionId, thingId: request.body.thingId }, 'Thing added to section');
				const things = await getCmsThingsInSection(fastify.mysql, request.params.sectionId);
				return reply.code(201).send(things);
			} catch (error) {
				if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
					return reply.code(409).send({ error: 'Thing already exists in this section' });
				}
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.delete<{ Params: ThingInSectionParams }>('/sections/:sectionId/things/:thingId', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Remove a thing from a section.',
			tags: ['CMS'],
			params: thingInSectionParams,
			response: {
				204: z.void(),
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				await removeThingFromSection(fastify.mysql, request.params.sectionId, request.params.thingId);
				request.log.info({ sectionId: request.params.sectionId, thingId: request.params.thingId }, 'Thing removed from section');
				return reply.code(204).send();
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.put<{ Params: SectionIdParam; Body: ReorderThingsRequest }>('/sections/:sectionId/things/reorder', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Reorder things within a section.',
			tags: ['CMS'],
			params: sectionIdParam,
			body: reorderThingsRequest,
			response: {
				200: cmsSectionThingsResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				400: errorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				const section = await getCmsSectionById(fastify.mysql, request.params.sectionId);

				if (!section) {
					return reply.code(404).send({ error: 'Section not found' });
				}

				const currentThingIds = await getSectionThingIds(fastify.mysql, request.params.sectionId);
				const requestedIds = new Set(request.body);
				const currentIds = new Set(currentThingIds);

				if (requestedIds.size !== currentIds.size || ![...requestedIds].every((id) => currentIds.has(id))) {
					return reply.code(400).send({ error: 'Thing IDs must match the current set of things in the section' });
				}

				await reorderThingsInSection(fastify.mysql, request.params.sectionId, request.body);
				request.log.info({ sectionId: request.params.sectionId, count: request.body.length }, 'Things reordered');
				return await getCmsThingsInSection(fastify.mysql, request.params.sectionId);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});
}
