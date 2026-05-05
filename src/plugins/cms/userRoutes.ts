import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../lib/schemas.js';
import { authErrorResponse } from '../auth/schemas.js';
import { requireAdmin, requireCanEditUsers } from './hooks.js';
import {
	cmsGroupsResponse,
	cmsUserResponse,
	cmsUsersResponse,
	userIdParam,
	createUserRequest,
	updateUserRequest,
	type UserIdParam,
	type CreateUserRequest,
	type UpdateUserRequest,
} from './userSchemas.js';
import {
	getGroups,
	getUsers,
	getUserById,
	updateCmsUser,
	deleteCmsUser,
	invalidateUserSessions,
} from './userDatabaseHelpers.js';
import { createUser, loginOrEmailExists, generateVerificationKey, updateUserRightsAndKey } from '../auth/databaseHelpers.js';
import { hashPassword } from '../auth/password.js';
import { setPasswordResetRequested } from '../auth/rights.js';
import { maskEmail } from '../../lib/maskEmail.js';
import { actorFingerprint } from '../../lib/actorFingerprint.js';

const adminHooks = [requireAdmin, requireCanEditUsers];

const ROOT_ADMIN_ID = 1;

export async function userRoutes(fastify: FastifyInstance) {
	// --- Groups reference ---

	fastify.get('/groups', {
		onRequest: adminHooks,
		schema: {
			description: 'List all auth groups.',
			tags: ['CMS'],
			response: {
				200: cmsGroupsResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (_request, reply) => {
			try {
				return await getGroups(fastify.mysql);
			} catch (error) {
				_request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	// --- List users ---

	fastify.get('/users', {
		onRequest: adminHooks,
		schema: {
			description: 'List all users.',
			tags: ['CMS'],
			response: {
				200: cmsUsersResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request, reply) => {
			try {
				return await getUsers(fastify.mysql);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	// --- Get user ---

	fastify.get('/users/:userId', {
		onRequest: adminHooks,
		schema: {
			description: 'Get a single user by ID.',
			tags: ['CMS'],
			params: userIdParam,
			response: {
				200: cmsUserResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: UserIdParam }>, reply) => {
			try {
				const user = await getUserById(fastify.mysql, request.params.userId);

				if (!user) {
					return reply.code(404).send({ error: 'User not found' });
				}

				return user;
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	// --- Create user ---

	fastify.post('/users', {
		onRequest: adminHooks,
		schema: {
			description: 'Create a new user. Sends activation email.',
			tags: ['CMS'],
			body: createUserRequest,
			response: {
				201: cmsUserResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: CreateUserRequest }>, reply) => {
			try {
				const { login, email, password, groupId } = request.body;

				if (await loginOrEmailExists(fastify.mysql, login, email)) {
					return reply.code(409).send({ error: 'Login or email already exists' });
				}

				const passwordHash = await hashPassword(password);
				const key = generateVerificationKey();

				const userId = await createUser(fastify.mysql, login, passwordHash, email, key, groupId);

				request.log.info({ subjectFingerprint: actorFingerprint(userId), email: maskEmail(email), actorFingerprint: actorFingerprint(request.user!.sub) }, 'Admin created user');

				await fastify.authNotifier.sendAdminActivation(email, login, key, fastify.resolveOrigin(request));

				const user = await getUserById(fastify.mysql, userId);
				return reply.code(201).send(user);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	// --- Update user ---

	fastify.put('/users/:userId', {
		onRequest: adminHooks,
		schema: {
			description: 'Update user group and/or rights.',
			tags: ['CMS'],
			params: userIdParam,
			body: updateUserRequest,
			response: {
				200: cmsUserResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: UserIdParam; Body: UpdateUserRequest }>, reply) => {
			try {
				const { userId } = request.params;
				const currentUser = await getUserById(fastify.mysql, userId);

				if (!currentUser) {
					return reply.code(404).send({ error: 'User not found' });
				}

				const isSelf = userId === request.user!.sub;
				const isRootAdmin = userId === ROOT_ADMIN_ID;
				const newGroupId = request.body.groupId ?? currentUser.groupId;
				const newRights = request.body.rights ?? currentUser.rights;

				// Root admin protection
				if (isRootAdmin && request.body.groupId !== undefined && request.body.groupId !== currentUser.groupId) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot change root admin group' });
				}

				if (isRootAdmin && (newRights & (1 << 2)) !== 0 && !currentUser.isBanned) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot ban root admin' });
				}

				// Self-protection: cannot change own group
				if (isSelf && request.body.groupId !== undefined && request.body.groupId !== currentUser.groupId) {
					return reply.code(409).send({ error: 'Cannot change own group' });
				}

				// Self-protection: cannot ban self (bit 2)
				if (isSelf && (newRights & (1 << 2)) !== 0 && !currentUser.isBanned) {
					return reply.code(409).send({ error: 'Cannot ban self' });
				}

				// Self-protection: cannot remove own canEditUsers (bit 14)
				// Check via XOR resolution: group XOR user for bit 14
				const groupRights = (await getGroups(fastify.mysql)).find((g) => g.id === newGroupId)?.rights ?? 0;
				const resolvedCanEditUsers = ((groupRights >> 14) & 1) !== ((newRights >> 14) & 1);

				if (isSelf && !resolvedCanEditUsers) {
					return reply.code(409).send({ error: 'Cannot remove own canEditUsers right' });
				}

				// Root admin protection: cannot remove canEditUsers
				if (isRootAdmin && !resolvedCanEditUsers) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot remove root admin canEditUsers right' });
				}

				await updateCmsUser(fastify.mysql, userId, newGroupId, newRights);
				await invalidateUserSessions(fastify.mysql, userId);

				request.log.info({ subjectFingerprint: actorFingerprint(userId), actorFingerprint: actorFingerprint(request.user!.sub) }, 'Admin updated user');

				return await getUserById(fastify.mysql, userId);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	// --- Delete user ---

	fastify.delete('/users/:userId', {
		onRequest: adminHooks,
		schema: {
			description: 'Delete a user account.',
			tags: ['CMS'],
			params: userIdParam,
			response: {
				204: z.void(),
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: UserIdParam }>, reply) => {
			try {
				const { userId } = request.params;

				if (userId === ROOT_ADMIN_ID) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot delete root admin' });
				}

				if (userId === request.user!.sub) {
					return reply.code(403).send({ error: 'forbidden', message: 'Cannot delete self' });
				}

				const user = await getUserById(fastify.mysql, userId);

				if (!user) {
					return reply.code(404).send({ error: 'User not found' });
				}

				await deleteCmsUser(fastify.mysql, userId);

				request.log.info({ subjectFingerprint: actorFingerprint(userId), actorFingerprint: actorFingerprint(request.user!.sub) }, 'Admin deleted user');

				return reply.code(204).send();
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	// --- Resend activation ---

	fastify.post('/users/:userId/resend-activation', {
		onRequest: adminHooks,
		schema: {
			description: 'Resend activation email for a user.',
			tags: ['CMS'],
			params: userIdParam,
			response: {
				200: z.object({ message: z.string() }),
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: UserIdParam }>, reply) => {
			try {
				const user = await getUserById(fastify.mysql, request.params.userId);

				if (!user) {
					return reply.code(404).send({ error: 'User not found' });
				}

				if (user.isEmailActivated) {
					return reply.code(409).send({ error: 'User is already activated' });
				}

				if (!user.email) {
					return reply.code(409).send({ error: 'User has no email' });
				}

				const key = generateVerificationKey();
				await updateUserRightsAndKey(fastify.mysql, user.id, user.rights, key);

				request.log.info({ subjectFingerprint: actorFingerprint(user.id), actorFingerprint: actorFingerprint(request.user!.sub) }, 'Admin resent activation');

				await fastify.authNotifier.sendAdminResendActivation(user.email!, user.login!, key, fastify.resolveOrigin(request));

				return { message: 'Activation email sent' };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	// --- Reset password ---

	fastify.post('/users/:userId/reset-password', {
		onRequest: adminHooks,
		schema: {
			description: 'Trigger password reset for a user.',
			tags: ['CMS'],
			params: userIdParam,
			response: {
				200: z.object({ message: z.string() }),
				401: authErrorResponse,
				403: authErrorResponse,
				404: errorResponse,
				409: errorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Params: UserIdParam }>, reply) => {
			try {
				const user = await getUserById(fastify.mysql, request.params.userId);

				if (!user) {
					return reply.code(404).send({ error: 'User not found' });
				}

				if (!user.email) {
					return reply.code(409).send({ error: 'User has no email' });
				}

				const key = generateVerificationKey();
				const newRights = setPasswordResetRequested(user.rights);
				await updateUserRightsAndKey(fastify.mysql, user.id, newRights, key);

				request.log.info({ subjectFingerprint: actorFingerprint(user.id), actorFingerprint: actorFingerprint(request.user!.sub) }, 'Admin triggered password reset');

				await fastify.authNotifier.sendAdminPasswordReset(user.email!, user.login!, key, fastify.resolveOrigin(request));

				return { message: 'Password reset email sent' };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});
}
