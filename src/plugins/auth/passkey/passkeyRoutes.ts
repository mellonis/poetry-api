import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture, RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { errorResponse } from '../../../lib/schemas.js';
import { actorFingerprint } from '../../../lib/actorFingerprint.js';
import { isBanned, isEmailActivated } from '../rights.js';
import { findUserByLogin, updateLastLogin } from '../databaseHelpers.js';
import { issueTokens } from '../issueTokens.js';
import {
	createPasskey,
	deletePasskey,
	findPasskeyByCredentialId,
	findPasskeysByUserId,
	updatePasskeyCounter,
} from './databaseHelpers.js';
import { createChallengeStore } from './challengeStore.js';
import {
	authErrorResponse,
	passkeyLoginOptionsRequest,
	type PasskeyLoginOptionsRequest,
	passkeyLoginOptionsResponse,
	passkeyLoginRequest,
	type PasskeyLoginRequest,
	passkeyLoginResponse,
	passkeyListResponse,
	passkeyRegisterOptionsResponse,
	passkeyRegisterVerifyRequest,
	type PasskeyRegisterVerifyRequest,
} from './schemas.js';

const RP_NAME = 'Mellonis Poetry';

const getAllowedOrigins = (): string[] =>
	(process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);

const getRpId = (): string => process.env.WEBAUTHN_RP_ID ?? 'poetry.mellonis.ru';

export async function passkeyRoutesPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: passkeyRoutes...');

	const challengeStore = createChallengeStore();
	challengeStore.startCleanup();

	fastify.addHook('onClose', () => {
		challengeStore.stopCleanup();
	});

	// POST /passkey/register/options — generate registration options (auth required)
	fastify.post('/passkey/register/options', {
		schema: {
			description: 'Generate WebAuthn registration options for the authenticated user.',
			tags: ['Passkey'],
			response: {
				200: passkeyRegisterOptionsResponse,
				401: authErrorResponse,
				500: errorResponse,
			},
		},
		preHandler: [fastify.verifyJwt],
		handler: async (request) => {
			try {
				const userId = request.user!.sub;
				const login = request.user!.login;

				const existingPasskeys = await findPasskeysByUserId(fastify.mysql, userId);
				const excludeCredentials = existingPasskeys.map((p) => ({
					id: p.credentialId,
					transports: (p.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
				}));

				const options = await generateRegistrationOptions({
					rpName: RP_NAME,
					rpID: getRpId(),
					userName: login,
					excludeCredentials,
					authenticatorSelection: {
						residentKey: 'preferred',
						userVerification: 'preferred',
					},
				});

				challengeStore.set(String(userId), options.challenge);

				return { options };
			} catch (error) {
				request.log.error(error);
				throw error;
			}
		},
	});

	// POST /passkey/register/verify — verify registration and store credential (auth required)
	fastify.post('/passkey/register/verify', {
		schema: {
			description: 'Verify WebAuthn registration response and store the passkey.',
			tags: ['Passkey'],
			body: passkeyRegisterVerifyRequest,
			response: {
				201: z.object({ message: z.string() }),
				400: authErrorResponse,
				401: authErrorResponse,
				500: errorResponse,
			},
		},
		preHandler: [fastify.verifyJwt],
		handler: async (request: FastifyRequest<{ Body: PasskeyRegisterVerifyRequest }>, reply) => {
			try {
				const userId = request.user!.sub;
				const expectedChallenge = challengeStore.get(String(userId));

				if (!expectedChallenge) {
					return reply.code(400).send({ error: 'challenge_expired', message: 'Challenge expired or not found. Please try again.' });
				}

				const verification = await verifyRegistrationResponse({
					response: request.body.credential as unknown as RegistrationResponseJSON,
					expectedChallenge,
					expectedOrigin: getAllowedOrigins(),
					expectedRPID: getRpId(),
				});

				if (!verification.verified || !verification.registrationInfo) {
					return reply.code(400).send({ error: 'verification_failed', message: 'Passkey verification failed' });
				}

				const { credential } = verification.registrationInfo;

				await createPasskey(
					fastify.mysql,
					userId,
					credential.id,
					Buffer.from(credential.publicKey),
					credential.counter,
					(credential.transports ?? null) as string[] | null,
					request.body.name,
				);

				request.log.info({ actorFingerprint: actorFingerprint(userId) }, 'Passkey registered');
				return reply.code(201).send({ message: 'Passkey registered successfully' });
			} catch (error) {
				request.log.error(error);
				throw error;
			}
		},
	});

	// POST /passkey/login/options — generate authentication options (public)
	fastify.post('/passkey/login/options', {
		schema: {
			description: 'Generate WebAuthn authentication options. Optionally provide a login to restrict to that user\'s passkeys.',
			tags: ['Passkey'],
			body: passkeyLoginOptionsRequest,
			response: {
				200: passkeyLoginOptionsResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: PasskeyLoginOptionsRequest }>) => {
			try {
				let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;

				if (request.body.login) {
					const user = await findUserByLogin(fastify.mysql, request.body.login);

					if (user) {
						const passkeys = await findPasskeysByUserId(fastify.mysql, user.userId);
						allowCredentials = passkeys.map((p) => ({
							id: p.credentialId,
							transports: (p.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
						}));
					} else {
						allowCredentials = [];
					}
				}

				const options = await generateAuthenticationOptions({
					rpID: getRpId(),
					allowCredentials,
					userVerification: 'preferred',
				});

				const challengeId = randomUUID();
				challengeStore.set(challengeId, options.challenge);

				return { challengeId, options };
			} catch (error) {
				request.log.error(error);
				throw error;
			}
		},
	});

	// POST /passkey/login — verify authentication and issue tokens (public)
	fastify.post('/passkey/login', {
		schema: {
			description: 'Verify WebAuthn authentication response and issue JWT tokens.',
			tags: ['Passkey'],
			body: passkeyLoginRequest,
			response: {
				200: passkeyLoginResponse,
				400: authErrorResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		handler: async (request: FastifyRequest<{ Body: PasskeyLoginRequest }>, reply) => {
			try {
				const expectedChallenge = challengeStore.get(request.body.challengeId);

				if (!expectedChallenge) {
					return reply.code(400).send({ error: 'challenge_expired', message: 'Challenge expired or not found. Please try again.' });
				}

				const credentialResponse = request.body.credential as unknown as AuthenticationResponseJSON;
				const passkey = await findPasskeyByCredentialId(fastify.mysql, credentialResponse.id);

				if (!passkey) {
					request.log.warn({ credentialId: credentialResponse.id }, 'Passkey login failed: credential not found');
					return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid credentials' });
				}

				if (isBanned(passkey.userRights)) {
					request.log.warn({ actorFingerprint: actorFingerprint(passkey.userId), reason: 'banned' }, 'Passkey login failed');
					return reply.code(403).send({ error: 'account_banned', message: 'Account is banned' });
				}

				if (!isEmailActivated(passkey.userRights)) {
					request.log.warn({ actorFingerprint: actorFingerprint(passkey.userId), reason: 'not_activated' }, 'Passkey login failed');
					return reply.code(403).send({ error: 'account_not_activated', message: 'Account requires email activation' });
				}

				const verification = await verifyAuthenticationResponse({
					response: credentialResponse,
					expectedChallenge,
					expectedOrigin: getAllowedOrigins(),
					expectedRPID: [getRpId()],
					credential: {
						id: passkey.credentialId,
						publicKey: new Uint8Array(passkey.publicKey),
						counter: passkey.counter,
						transports: (passkey.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
					},
				});

				if (!verification.verified) {
					request.log.warn({ actorFingerprint: actorFingerprint(passkey.userId), reason: 'verification_failed' }, 'Passkey login failed');
					return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid credentials' });
				}

				await updatePasskeyCounter(fastify.mysql, passkey.id, verification.authenticationInfo.newCounter);
				await updateLastLogin(fastify.mysql, passkey.userId);

				request.log.info({ actorFingerprint: actorFingerprint(passkey.userId) }, 'Passkey login successful');
				return await issueTokens(
					fastify, passkey.userId, passkey.login, passkey.userRights, passkey.groupRights, passkey.groupId, passkey.tokenVersion,
				);
			} catch (error) {
				request.log.error(error);
				throw error;
			}
		},
	});

	// GET /passkeys — list user's passkeys (auth required)
	fastify.get('/passkeys', {
		schema: {
			description: 'List all passkeys for the authenticated user.',
			tags: ['Passkey'],
			response: {
				200: passkeyListResponse,
				401: authErrorResponse,
				500: errorResponse,
			},
		},
		preHandler: [fastify.verifyJwt],
		handler: async (request) => {
			try {
				const passkeys = await findPasskeysByUserId(fastify.mysql, request.user!.sub);

				return passkeys.map((p) => ({
					id: p.id,
					name: p.name,
					createdAt: p.createdAt.toISOString(),
					lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
				}));
			} catch (error) {
				request.log.error(error);
				throw error;
			}
		},
	});

	// DELETE /passkeys/:passkeyId — remove a passkey (auth required)
	fastify.delete('/passkeys/:passkeyId', {
		schema: {
			description: 'Delete a passkey owned by the authenticated user.',
			tags: ['Passkey'],
			params: z.object({
				passkeyId: z.coerce.number().int().positive(),
			}),
			response: {
				204: z.void(),
				401: authErrorResponse,
				404: authErrorResponse,
				500: errorResponse,
			},
		},
		preHandler: [fastify.verifyJwt],
		handler: async (request: FastifyRequest<{ Params: { passkeyId: number } }>, reply) => {
			try {
				const deleted = await deletePasskey(fastify.mysql, request.params.passkeyId, request.user!.sub);

				if (!deleted) {
					return reply.code(404).send({ error: 'not_found', message: 'Passkey not found' });
				}

				request.log.info({ actorFingerprint: actorFingerprint(request.user!.sub), passkeyId: request.params.passkeyId }, 'Passkey deleted');
				return reply.code(204).send();
			} catch (error) {
				request.log.error(error);
				throw error;
			}
		},
	});

	fastify.log.info('[PLUGIN] Registered: passkeyRoutes');
}
