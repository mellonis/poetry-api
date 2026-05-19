import type { FastifyInstance, FastifyRequest } from 'fastify';
import { actorFingerprint } from '../../lib/actorFingerprint.js';
import { errorResponse } from '../../lib/schemas.js';
import { authErrorResponse } from '../auth/schemas.js';
import {
	getNotificationSettings,
	updateNotificationSettings,
} from '../users/databaseHelpers.js';
import {
	countUnread,
	listNotifications,
	markRead,
	markAllRead,
	deleteNotification,
} from './databaseHelpers.js';
import {
	notificationParams,
	notificationListQuery,
	notificationListResponse,
	summaryResponse,
	okResponse,
	markAllReadResponse,
	settingsResponse,
	updateSettingsRequest,
	errorBody,
	type NotificationParams,
	type NotificationListQuery,
	type UpdateSettingsRequest,
} from './schemas.js';

export async function notificationsPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: notifications...');

	fastify.get('/summary', {
		schema: {
			description: 'Lightweight unread-count for the header badge poll.',
			tags: ['Notifications'],
			response: { 200: summaryResponse, 401: authErrorResponse, 500: errorResponse },
		},
		preHandler: fastify.verifyJwt,
		handler: async (request) => {
			const userId = request.user!.sub;
			const unreadCount = await countUnread(fastify.mysql, userId);
			return { unreadCount };
		},
	});

	fastify.get('/', {
		schema: {
			description: "Paginated list of the caller's notifications. Keyset cursor on (updated_at, id).",
			tags: ['Notifications'],
			querystring: notificationListQuery,
			response: { 200: notificationListResponse, 401: authErrorResponse, 500: errorResponse },
		},
		preHandler: fastify.verifyJwt,
		handler: async (request: FastifyRequest<{ Querystring: NotificationListQuery }>) => {
			const userId = request.user!.sub;
			return listNotifications(fastify.mysql, userId, {
				cursor: request.query.cursor,
				limit: request.query.limit,
				unreadOnly: request.query.unreadOnly,
			});
		},
	});

	fastify.post('/:notificationId/read', {
		schema: {
			description: 'Mark a single notification as read. Idempotent.',
			tags: ['Notifications'],
			params: notificationParams,
			response: { 200: okResponse, 401: authErrorResponse, 404: errorResponse, 500: errorResponse },
		},
		preHandler: fastify.verifyJwt,
		handler: async (request: FastifyRequest<{ Params: NotificationParams }>, reply) => {
			const userId = request.user!.sub;
			const { notificationId } = request.params;
			const affected = await markRead(fastify.mysql, notificationId, userId);
			if (!affected) return reply.code(404).send(errorBody('not_found'));
			request.log.info(
				{ notificationId, actorFingerprint: actorFingerprint(userId) },
				'Notification marked read',
			);
			return { ok: true as const };
		},
	});

	fastify.post('/read-all', {
		schema: {
			description: 'Mark every unread notification for the caller as read.',
			tags: ['Notifications'],
			response: { 200: markAllReadResponse, 401: authErrorResponse, 500: errorResponse },
		},
		preHandler: fastify.verifyJwt,
		handler: async (request) => {
			const userId = request.user!.sub;
			const marked = await markAllRead(fastify.mysql, userId);
			request.log.info(
				{ actorFingerprint: actorFingerprint(userId), marked },
				'Notifications mark-all-read',
			);
			return { ok: true as const, marked };
		},
	});

	fastify.delete('/:notificationId', {
		schema: {
			description: 'Delete a single notification permanently.',
			tags: ['Notifications'],
			params: notificationParams,
			response: { 200: okResponse, 401: authErrorResponse, 404: errorResponse, 500: errorResponse },
		},
		preHandler: fastify.verifyJwt,
		handler: async (request: FastifyRequest<{ Params: NotificationParams }>, reply) => {
			const userId = request.user!.sub;
			const { notificationId } = request.params;
			const affected = await deleteNotification(fastify.mysql, notificationId, userId);
			if (!affected) return reply.code(404).send(errorBody('not_found'));
			request.log.info(
				{ notificationId, actorFingerprint: actorFingerprint(userId) },
				'Notification deleted',
			);
			return { ok: true as const };
		},
	});

	fastify.get('/settings', {
		schema: {
			description: 'Get notification preferences for the authenticated user.',
			tags: ['Notifications'],
			response: { 200: settingsResponse, 401: authErrorResponse, 404: errorResponse, 500: errorResponse },
		},
		preHandler: fastify.verifyJwt,
		handler: async (request, reply) => {
			const userId = request.user!.sub;
			const settings = await getNotificationSettings(fastify.mysql, userId);
			if (!settings) return reply.code(404).send(errorBody('not_found'));
			return settings;
		},
	});

	fastify.put('/settings', {
		schema: {
			description: 'Update notification preferences for the authenticated user.',
			tags: ['Notifications'],
			body: updateSettingsRequest,
			response: { 200: settingsResponse, 401: authErrorResponse, 404: errorResponse, 500: errorResponse },
		},
		preHandler: fastify.verifyJwt,
		handler: async (request: FastifyRequest<{ Body: UpdateSettingsRequest }>, reply) => {
			const userId = request.user!.sub;
			await updateNotificationSettings(fastify.mysql, userId, request.body);
			const settings = await getNotificationSettings(fastify.mysql, userId);
			if (!settings) return reply.code(404).send(errorBody('not_found'));
			request.log.info(
				{ actorFingerprint: actorFingerprint(userId), settings: request.body },
				'Notification settings updated',
			);
			return settings;
		},
	});

	fastify.log.info('[PLUGIN] Registered: notifications');
}
