import type { FastifyInstance } from 'fastify';
import { errorResponse } from '../../lib/schemas.js';
import { authErrorResponse } from '../auth/schemas.js';
import { getThingsOfTheDayCalendar } from './databaseHelpers.js';
import { cmsThingsOfTheDayCalendarResponse } from './schemas.js';

export async function calendarRoutes(fastify: FastifyInstance) {
	fastify.get('/things-of-the-day/calendar', {
		schema: {
			description: 'Rolling 365–366 day calendar of things-of-the-day, with simulated fallback picks for empty days. Spans today through the same date one year minus one day later.',
			tags: ['CMS'],
			response: {
				200: cmsThingsOfTheDayCalendarResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				return await getThingsOfTheDayCalendar(fastify.mysql);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});
}
