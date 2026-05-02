import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../lib/schemas.js';
import { sendEmail } from '../../lib/email.js';
import { accountDeletedEmail } from '../../lib/emailTemplates.js';
import { checkPassword, hashPassword } from '../auth/password.js';
import { deleteAllUserRefreshTokens } from '../auth/databaseHelpers.js';
import { getUserCredentials, updatePassword, deleteUser, getNotificationSettings, updateNotificationSettings } from './databaseHelpers.js';
import { authErrorResponse } from '../auth/schemas.js';
import {
	userIdParam,
	changePasswordRequest,
	deleteUserRequest,
	notificationSettingsResponse,
	updateNotificationSettingsRequest,
	type UserIdParam,
	type ChangePasswordRequest,
	type DeleteUserRequest,
	type UpdateNotificationSettingsRequest,
} from './schemas.js';

export async function usersPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: users...');

	fastify.addHook('onRequest', fastify.verifyJwt);

	fastify.patch('/:userId/password', {
		schema: {
			description: 'Change the authenticated user\'s password. Revokes all sessions.',
			tags: ['Users'],
			params: userIdParam,
			body: changePasswordRequest,
			response: {
				200: z.object({ message: z.string() }),
				401: authErrorResponse,
				403: authErrorResponse,
				404: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: UserIdParam; Body: ChangePasswordRequest }>, reply) => {
			try {
				const { userId } = request.params;
				const { currentPassword, newPassword } = request.body;
				const user = request.user!;

				const isSelf = user.sub === userId;

				if (!isSelf) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot change another user\'s password' });
				}

				const credentials = await getUserCredentials(fastify.mysql, userId);

				if (!credentials) {
					return reply.code(404).send({ error: 'user_not_found', message: 'User not found' });
				}

				const passwordValid = await checkPassword(currentPassword, credentials.passwordHash);

				if (!passwordValid) {
					request.log.warn({ login: user.login, userId }, 'Password change failed: invalid current password');
					return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid credentials' });
				}

				const newHash = await hashPassword(newPassword);
				await updatePassword(fastify.mysql, userId, newHash);
				await deleteAllUserRefreshTokens(fastify.mysql, userId);
				await fastify.authNotifier.sendPasswordChanged(credentials.email, user.login, fastify.resolveOrigin(request));

				request.log.info({ login: user.login, userId }, 'Password changed');
				return { message: 'Password changed successfully' };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.delete('/:userId', {
		schema: {
			description: 'Delete the authenticated user\'s account. Requires password confirmation.',
			tags: ['Users'],
			params: userIdParam,
			body: deleteUserRequest,
			response: {
				204: z.void(),
				401: authErrorResponse,
				403: authErrorResponse,
				404: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: UserIdParam; Body: DeleteUserRequest }>, reply) => {
			try {
				const { userId } = request.params;
				const { password } = request.body;
				const user = request.user!;

				const isSelf = user.sub === userId;

				if (!isSelf) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot delete another user\'s account' });
				}

				const credentials = await getUserCredentials(fastify.mysql, userId);

				if (!credentials) {
					return reply.code(404).send({ error: 'user_not_found', message: 'User not found' });
				}

				const passwordValid = await checkPassword(password, credentials.passwordHash);

				if (!passwordValid) {
					request.log.warn({ login: user.login, userId }, 'Account deletion failed: invalid password');
					return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid credentials' });
				}

				await deleteAllUserRefreshTokens(fastify.mysql, userId);
				await deleteUser(fastify.mysql, userId);

				request.log.info({ login: user.login, userId }, 'Account deleted');

				const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;

				if (adminEmail) {
					sendEmail(adminEmail, accountDeletedEmail(user.login)).catch((err) => {
						request.log.warn(err, 'Admin account deletion notification failed');
					});
				}

				return reply.code(204).send();
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.get('/:userId/notification-settings', {
		schema: {
			description: 'Get notification preferences for the authenticated user.',
			tags: ['Users'],
			params: userIdParam,
			response: {
				200: notificationSettingsResponse,
				403: authErrorResponse,
				404: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: UserIdParam }>, reply) => {
			try {
				const { userId } = request.params;
				const user = request.user!;

				if (user.sub !== userId) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot read another user\'s notification settings' });
				}

				const settings = await getNotificationSettings(fastify.mysql, userId);

				if (!settings) {
					return reply.code(404).send({ error: 'user_not_found', message: 'User not found' });
				}

				return settings;
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.put('/:userId/notification-settings', {
		schema: {
			description: 'Update notification preferences for the authenticated user.',
			tags: ['Users'],
			params: userIdParam,
			body: updateNotificationSettingsRequest,
			response: {
				200: notificationSettingsResponse,
				403: authErrorResponse,
				404: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (
			request: FastifyRequest<{ Params: UserIdParam; Body: UpdateNotificationSettingsRequest }>,
			reply,
		) => {
			try {
				const { userId } = request.params;
				const user = request.user!;

				if (user.sub !== userId) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot update another user\'s notification settings' });
				}

				const existing = await getNotificationSettings(fastify.mysql, userId);

				if (!existing) {
					return reply.code(404).send({ error: 'user_not_found', message: 'User not found' });
				}

				const { notifyAuthorOnCommentReply, notifyAuthorOnCommentVote } = request.body;
				await updateNotificationSettings(fastify.mysql, userId, { notifyAuthorOnCommentReply, notifyAuthorOnCommentVote });
				request.log.info({ userId }, 'Notification settings updated');

				return { notifyAuthorOnCommentReply, notifyAuthorOnCommentVote };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.log.info('[PLUGIN] Registered: users');
}
