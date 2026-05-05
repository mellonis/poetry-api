import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../lib/schemas.js';
import { maskEmail } from '../../lib/maskEmail.js';
import { sendEmail } from '../../lib/email.js';
import { accountRegisteredEmail } from '../../lib/emailTemplates.js';
import { checkPassword, hashPassword, needsRehash } from './password.js';
import { hashRefreshToken } from './jwt.js';
import {
	isBanned,
	isEmailActivated,
	isPasswordResetRequested,
	clearPasswordResetRequested,
	setEmailActivated,
	setPasswordResetRequested
} from './rights.js';
import {
	createUser,
	deleteAllUserRefreshTokens,
	findAndDeleteRefreshToken,
	findUserByEmail,
	findUserByKey,
	findUserByLogin,
	generateVerificationKey,
	isActivationKeyExpired,
	isResetKeyExpired,
	loginOrEmailExists,
	rehashPassword,
	resetPassword,
	updateLastLogin,
	updateUserRightsAndKey,
} from './databaseHelpers.js';
import { issueTokens } from './issueTokens.js';
import { actorFingerprint } from '../../lib/actorFingerprint.js';
import {
	activateRequest,
	type ActivateRequest,
	authErrorResponse,
	loginRequest,
	type LoginRequest,
	loginResponse,
	logoutRequest,
	type LogoutRequest,
	refreshRequest,
	type RefreshRequest,
	refreshResponse,
	registerRequest,
	type RegisterRequest,
	resendActivationRequest,
	type ResendActivationRequest,
	requestPasswordResetRequest,
	type RequestPasswordResetRequest,
	resetPasswordRequest,
	type ResetPasswordRequest,
} from './schemas.js';

export async function authRoutesPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: authRoutes...');

	fastify.post('/login', {
		schema: {
			description: 'Authenticate with login and password. Returns JWT access and refresh tokens.',
			tags: ['Auth'],
			body: loginRequest,
			response: {
				200: loginResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: LoginRequest }>, reply) => {
			try {
				const { login, password } = request.body;
				const user = await findUserByLogin(fastify.mysql, login);

				if (!user) {
					request.log.warn({ reason: 'user_not_found' }, 'Login failed');
					return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid credentials' });
				}

				const passwordValid = await checkPassword(password, user.passwordHash);

				if (!passwordValid) {
					request.log.warn({ actorFingerprint: actorFingerprint(user.userId), reason: 'invalid_password' }, 'Login failed');
					return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid credentials' });
				}

				if (isBanned(user.userRights)) {
					request.log.warn({ actorFingerprint: actorFingerprint(user.userId), reason: 'banned' }, 'Login failed');
					return reply.code(403).send({ error: 'account_banned', message: 'Account is banned' });
				}

				if (!isEmailActivated(user.userRights)) {
					request.log.warn({ actorFingerprint: actorFingerprint(user.userId), reason: 'not_activated' }, 'Login failed');
					return reply.code(403).send({ error: 'account_not_activated', message: 'Account requires email activation' });
				}

				if (needsRehash(user.passwordHash)) {
					const newHash = await hashPassword(password);
					await rehashPassword(fastify.mysql, user.userId, newHash);
					request.log.info({ actorFingerprint: actorFingerprint(user.userId) }, 'Password rehashed from MD5 to bcrypt');
				}

				await updateLastLogin(fastify.mysql, user.userId);

				request.log.info({ actorFingerprint: actorFingerprint(user.userId) }, 'Login successful');
				return await issueTokens(fastify, user.userId, user.login, user.userRights, user.groupRights, user.groupId, user.tokenVersion);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post('/refresh', {
		schema: {
			description: 'Exchange a valid refresh token for a new access/refresh token pair.',
			tags: ['Auth'],
			body: refreshRequest,
			response: {
				200: refreshResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: RefreshRequest }>, reply) => {
			try {
				const tokenHash = hashRefreshToken(request.body.refreshToken);
				const user = await findAndDeleteRefreshToken(fastify.mysql, tokenHash);

				if (!user) {
					request.log.warn('Token refresh failed: invalid or expired refresh token');
					return reply.code(401).send({ error: 'invalid_refresh_token', message: 'Invalid or expired refresh token' });
				}

				if (isBanned(user.userRights)) {
					request.log.warn({ actorFingerprint: actorFingerprint(user.userId) }, 'Token refresh failed: account banned');
					return reply.code(403).send({ error: 'account_banned', message: 'Account is banned' });
				}

				const { accessToken, refreshToken } = await issueTokens(
					fastify, user.userId, user.login, user.userRights, user.groupRights, user.groupId, user.tokenVersion,
				);

				return { accessToken, refreshToken };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post('/logout', {
		schema: {
			description: 'Invalidate a refresh token (sign out).',
			tags: ['Auth'],
			body: logoutRequest,
			response: {
				204: z.void(),
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: LogoutRequest }>, reply) => {
			try {
				const tokenHash = hashRefreshToken(request.body.refreshToken);
				await findAndDeleteRefreshToken(fastify.mysql, tokenHash);

				return reply.code(204).send();
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post('/register', {
		schema: {
			description: 'Create a new user account and send an activation email.',
			tags: ['Auth'],
			body: registerRequest,
			response: {
				201: z.object({ message: z.string() }),
				409: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: RegisterRequest }>, reply) => {
			try {
				const { login, password, email } = request.body;

				if (await loginOrEmailExists(fastify.mysql, login, email)) {
					return reply.code(409).send({ error: 'invalid_input', message: 'Login or email is already in use' });
				}

				const passwordHash = await hashPassword(password);
				const key = generateVerificationKey();

				await createUser(fastify.mysql, login, passwordHash, email, key);
				request.log.info({ email: maskEmail(email) }, 'User registered');

				try {
					await fastify.authNotifier.sendActivation(email, login, key, fastify.resolveOrigin(request));
				} catch (notifierError) {
					fastify.log.error({ email: maskEmail(email), err: notifierError }, 'Failed to send activation email');
				}

				const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;

					if (adminEmail) {
						sendEmail(adminEmail, accountRegisteredEmail(login)).catch((err) => {
							request.log.warn(err, 'Admin registration notification failed');
						});
					}

					return reply.code(201).send({ message: 'Registration successful. Check your email to activate your account.' });
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post('/activate', {
		schema: {
			description: 'Activate a user account using the key from the activation email.',
			tags: ['Auth'],
			body: activateRequest,
			response: {
				200: z.object({ message: z.string() }),
				400: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: ActivateRequest }>, reply) => {
			try {
				const { key } = request.body;

				if (isActivationKeyExpired(key)) {
					return reply.code(400).send({ error: 'key_expired', message: 'Activation key has expired' });
				}

				const user = await findUserByKey(fastify.mysql, key);

				if (!user) {
					return reply.code(400).send({ error: 'invalid_key', message: 'Invalid activation key' });
				}

				if (isEmailActivated(user.userRights)) {
					return reply.code(400).send({ error: 'already_activated', message: 'Account is already activated' });
				}

				const newRights = setEmailActivated(user.userRights);
				await updateUserRightsAndKey(fastify.mysql, user.userId, newRights, null);

				request.log.info({ actorFingerprint: actorFingerprint(user.userId) }, 'Account activated');
				return { message: 'Account activated successfully' };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post('/resend-activation', {
		schema: {
			description: 'Resend the activation email for an unactivated account.',
			tags: ['Auth'],
			body: resendActivationRequest,
			response: {
				200: z.object({ message: z.string() }),
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: ResendActivationRequest }>, reply) => {
			try {
				const { login } = request.body;
				const user = await findUserByLogin(fastify.mysql, login);

				if (user && !isEmailActivated(user.userRights)) {
					const key = generateVerificationKey();
					await updateUserRightsAndKey(fastify.mysql, user.userId, user.userRights, key);

					try {
						await fastify.authNotifier.sendActivation(user.email, user.login, key, fastify.resolveOrigin(request));
					} catch (notifierError) {
						fastify.log.error({ email: maskEmail(user.email), err: notifierError }, 'Failed to send activation email');
					}
				}

				// Always return success to prevent login enumeration
				return { message: 'If the account exists and is not yet activated, an activation email has been sent' };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post('/request-password-reset', {
		schema: {
			description: 'Request a password reset email for the given email address.',
			tags: ['Auth'],
			body: requestPasswordResetRequest,
			response: {
				200: z.object({ message: z.string() }),
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: RequestPasswordResetRequest }>, reply) => {
			try {
				const user = await findUserByEmail(fastify.mysql, request.body.email);

				if (user) {
					const key = generateVerificationKey();
					const newRights = setPasswordResetRequested(user.userRights);

					await updateUserRightsAndKey(fastify.mysql, user.userId, newRights, key);
					request.log.info({ actorFingerprint: actorFingerprint(user.userId) }, 'Password reset requested');

					await fastify.authNotifier.sendPasswordReset(user.email, user.login, key, fastify.resolveOrigin(request));
				}

				return { message: 'If an account exists, a password reset link has been sent' };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post('/reset-password', {
		schema: {
			description: 'Set a new password using the key from the reset email.',
			tags: ['Auth'],
			body: resetPasswordRequest,
			response: {
				200: z.object({ message: z.string() }),
				400: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: ResetPasswordRequest }>, reply) => {
			try {
				const { key, newPassword } = request.body;

				if (isResetKeyExpired(key)) {
					return reply.code(400).send({ error: 'key_expired', message: 'Reset key has expired' });
				}

				const user = await findUserByKey(fastify.mysql, key);

				if (!user || !isPasswordResetRequested(user.userRights)) {
					return reply.code(400).send({ error: 'invalid_key', message: 'Invalid reset key' });
				}

				const passwordHash = await hashPassword(newPassword);
				const newRights = setEmailActivated(clearPasswordResetRequested(user.userRights));

				await resetPassword(fastify.mysql, user.userId, passwordHash, newRights);
				await deleteAllUserRefreshTokens(fastify.mysql, user.userId);

				request.log.info({ actorFingerprint: actorFingerprint(user.userId) }, 'Password reset completed');
				return { message: 'Password reset successfully' };
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.log.info('[PLUGIN] Registered: authRoutes');
}
