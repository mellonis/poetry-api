import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../lib/schemas.js';
import { authErrorResponse } from '../auth/schemas.js';
import {
	getSectionTypes,
	getSectionStatuses,
	getCmsSections,
	getCmsSectionById,
	createSection,
	updateSection,
	deleteSection,
	getExternalRedirectsToSection,
	hasRedirectLoop,
	reorderSections,
} from './databaseHelpers.js';
import {
	sectionTypesResponse,
	cmsSectionsResponse,
	cmsSectionItem,
	sectionIdParam,
	createSectionRequest,
	updateSectionRequest,
	reorderSectionsRequest,
	type SectionIdParam,
	type CreateSectionRequest,
	type UpdateSectionRequest,
	type ReorderSectionsRequest,
} from './schemas.js';
import { requireCanEditContent } from './hooks.js';

export async function sectionRoutes(fastify: FastifyInstance) {
	fastify.get('/section-types', {
		schema: {
			description: 'List section types.',
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
				return await getSectionTypes(fastify.mysql);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.get('/section-statuses', {
		schema: {
			description: 'List section statuses.',
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
				return await getSectionStatuses(fastify.mysql);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.get('/sections', {
		schema: {
			description: 'List all sections.',
			tags: ['CMS'],
			response: {
				200: cmsSectionsResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				return await getCmsSections(fastify.mysql);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post('/sections', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Create a new section.',
			tags: ['CMS'],
			body: createSectionRequest,
			response: {
				201: cmsSectionItem,
				401: authErrorResponse,
				403: authErrorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: CreateSectionRequest }>, reply) => {
			try {
				const { redirectSectionId } = request.body;

				if (redirectSectionId !== null) {
					const loop = await hasRedirectLoop(fastify.mysql, 0, redirectSectionId);
					if (loop) {
						return reply.code(409).send({ error: 'Redirect would create a loop' });
					}
				}

				const id = await createSection(fastify.mysql, request.body);
				const section = await getCmsSectionById(fastify.mysql, id);

				request.log.info({ sectionId: id }, 'Section created');
				return reply.code(201).send(section);
			} catch (error) {
				if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
					return reply.code(409).send({ error: 'Section identifier already exists' });
				}
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.put<{ Params: SectionIdParam; Body: UpdateSectionRequest }>('/sections/:sectionId', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Update a section.',
			tags: ['CMS'],
			params: sectionIdParam,
			body: updateSectionRequest,
			response: {
				200: cmsSectionItem,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				const current = await getCmsSectionById(fastify.mysql, request.params.sectionId);

				if (!current) {
					return reply.code(404).send({ error: 'Section not found' });
				}

				const { redirectSectionId } = request.body;

				if (redirectSectionId !== undefined && redirectSectionId !== null) {
					const loop = await hasRedirectLoop(fastify.mysql, request.params.sectionId, redirectSectionId);
					if (loop) {
						return reply.code(409).send({ error: 'Redirect would create a loop' });
					}
				}

				await updateSection(fastify.mysql, request.params.sectionId, request.body, current);
				const updated = await getCmsSectionById(fastify.mysql, request.params.sectionId);

				request.log.info({ sectionId: request.params.sectionId }, 'Section updated');
				return updated;
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.delete<{ Params: SectionIdParam }>('/sections/:sectionId', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Delete a section. Cascades thing_identifiers. Refuses if external redirects exist.',
			tags: ['CMS'],
			params: sectionIdParam,
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
				const current = await getCmsSectionById(fastify.mysql, request.params.sectionId);

				if (!current) {
					return reply.code(404).send({ error: 'Section not found' });
				}

				const redirects = await getExternalRedirectsToSection(fastify.mysql, request.params.sectionId);

				if (redirects.length > 0) {
					const sources = redirects.map((r) => `${r.fromSectionIdentifier}:thing#${r.fromThingId}`).join(', ');
					return reply.code(409).send({ error: `Section has incoming redirects from: ${sources}` });
				}

				await deleteSection(fastify.mysql, request.params.sectionId);
				request.log.info({ sectionId: request.params.sectionId }, 'Section deleted');
				return reply.code(204).send();
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.put<{ Body: ReorderSectionsRequest }>('/sections/reorder', {
		onRequest: requireCanEditContent,
		schema: {
			description: 'Reorder sections.',
			tags: ['CMS'],
			body: reorderSectionsRequest,
			response: {
				200: cmsSectionsResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				await reorderSections(fastify.mysql, request.body);
				request.log.info({ count: request.body.length }, 'Sections reordered');
				return await getCmsSections(fastify.mysql);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});
}
