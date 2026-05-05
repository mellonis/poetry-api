import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../lib/schemas.js';
import { sendEmail } from '../../lib/email.js';
import { accountDeletedEmail } from '../../lib/emailTemplates.js';
import { checkPassword, hashPassword } from '../auth/password.js';
import { deleteAllUserRefreshTokens } from '../auth/databaseHelpers.js';
import { getUserCredentials, updatePassword, deleteUser, getNotificationSettings, updateNotificationSettings, getDisplayName, setDisplayName, isReservedDisplayName } from './databaseHelpers.js';
import { authErrorResponse } from '../auth/schemas.js';
import { actorFingerprint } from '../../lib/actorFingerprint.js';
import { validateDisplayName } from '../../lib/displayName.js';
import {
	userIdParam,
	changePasswordRequest,
	deleteUserRequest,
	notificationSettingsResponse,
	updateNotificationSettingsRequest,
	displayNameResponse,
	updateDisplayNameRequest,
	type UserIdParam,
	type ChangePasswordRequest,
	type DeleteUserRequest,
	type UpdateNotificationSettingsRequest,
	type UpdateDisplayNameRequest,
} from './schemas.js';

const DISPLAY_NAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const isInDisplayNameCooldown = (changedAt: Date | null): boolean =>
	changedAt !== null && Date.now() - changedAt.getTime() < DISPLAY_NAME_COOLDOWN_MS;

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
					request.log.warn({ actorFingerprint: actorFingerprint(userId) }, 'Password change failed: invalid current password');
					return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid credentials' });
				}

				const newHash = await hashPassword(newPassword);
				await updatePassword(fastify.mysql, userId, newHash);
				await deleteAllUserRefreshTokens(fastify.mysql, userId);
				await fastify.authNotifier.sendPasswordChanged(credentials.email, user.login, fastify.resolveOrigin(request));

				request.log.info({ actorFingerprint: actorFingerprint(userId) }, 'Password changed');
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
					request.log.warn({ actorFingerprint: actorFingerprint(userId) }, 'Account deletion failed: invalid password');
					return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid credentials' });
				}

				await deleteAllUserRefreshTokens(fastify.mysql, userId);
				await deleteUser(fastify.mysql, userId);

				request.log.info({ actorFingerprint: actorFingerprint(userId) }, 'Account deleted');

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
				request.log.info({ actorFingerprint: actorFingerprint(userId) }, 'Notification settings updated');

				return { notifyAuthorOnCommentReply, notifyAuthorOnCommentVote };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.get('/:userId/display-name', {
		schema: {
			description: 'Get display name for the authenticated user.',
			tags: ['Users'],
			params: userIdParam,
			response: {
				200: displayNameResponse,
				403: authErrorResponse,
				404: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: UserIdParam }>, reply) => {
			try {
				const { userId } = request.params;
				if (request.user!.sub !== userId) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot read another user\'s display name' });
				}
				const info = await getDisplayName(fastify.mysql, userId);
				if (!info) return reply.code(404).send({ error: 'user_not_found', message: 'User not found' });
				return {
					displayName: info.displayName,
					inCooldown: isInDisplayNameCooldown(info.displayNameChangedAt),
				};
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});


	fastify.put('/:userId/display-name', {
		schema: {
			description: 'Update display name for the authenticated user. Rate-limited to once per 7 days.',
			tags: ['Users'],
			params: userIdParam,
			body: updateDisplayNameRequest,
			response: {
				200: displayNameResponse,
				400: errorResponse,
				403: authErrorResponse,
				404: authErrorResponse,
				409: errorResponse,
				429: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (
			request: FastifyRequest<{ Params: UserIdParam; Body: UpdateDisplayNameRequest }>,
			reply,
		) => {
			try {
				const { userId } = request.params;
				if (request.user!.sub !== userId) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot change another user\'s display name' });
				}

				const result = validateDisplayName(request.body.displayName);
				if (!result.ok) return reply.code(400).send({ error: result.error });

				const info = await getDisplayName(fastify.mysql, userId);
				if (!info) return reply.code(404).send({ error: 'user_not_found', message: 'User not found' });

				if (isInDisplayNameCooldown(info.displayNameChangedAt)) {
					return reply.code(429).send({ error: 'display_name_cooldown', message: 'Display name can only be changed once per 7 days' });
				}

				const reserved = await isReservedDisplayName(fastify.mysql, result.value);
				if (reserved) {
					return reply.code(409).send({ error: 'display_name_reserved', message: 'This display name is not available' });
				}

				await setDisplayName(fastify.mysql, userId, result.value);
				request.log.info({ actorFingerprint: actorFingerprint(userId) }, 'Display name updated');
				return {
					displayName: result.value,
					inCooldown: true,
				};
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.log.info('[PLUGIN] Registered: users');
}
