import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../../lib/schemas.js';
import { actorFingerprint } from '../../../lib/actorFingerprint.js';
import { authErrorResponse } from '../schemas.js';
import { findUserById } from '../databaseHelpers.js';
import { hashToken } from '../jwt.js';
import { generatePersonalAccessToken } from './token.js';
import { levelAtLeast, resolveAccountLevel, scopeToDb } from './scope.js';
import {
	createPersonalAccessToken,
	deletePersonalAccessToken,
	listPersonalAccessTokens,
} from './databaseHelpers.js';
import {
	createPersonalAccessTokenRequest,
	createPersonalAccessTokenResponse,
	personalAccessTokenIdParam,
	personalAccessTokenListResponse,
	type CreatePersonalAccessTokenRequest,
	type PersonalAccessTokenIdParam,
} from './schemas.js';

const CREATE_RATE_LIMIT = { max: 10, timeWindow: '1 hour' };

// Personal access tokens are managed under a normal JWT session and accepted
// only by POST /mcp — a leaked token cannot mint more tokens or reach REST.
// See docs/auth.md (personal access tokens).
export async function patRoutesPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: patRoutes...');

	fastify.get('/tokens', {
		schema: {
			description: 'List the personal access tokens of the authenticated user (never the secret).',
			tags: ['Personal Access Tokens'],
			response: { 200: personalAccessTokenListResponse, 401: authErrorResponse, 500: errorResponse },
		},
		preHandler: [fastify.verifyJwt],
		handler: async (request) => {
			try {
				const tokens = await listPersonalAccessTokens(fastify.mysql, request.user!.sub);

				return tokens.map((t) => ({
					id: t.id,
					name: t.name,
					scope: t.scope,
					createdAt: t.createdAt.toISOString(),
					lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
				}));
			} catch (error) {
				request.log.error(error);
				throw error;
			}
		},
	});

	fastify.post('/tokens', {
		config: { rateLimit: CREATE_RATE_LIMIT },
		schema: {
			description: 'Create a personal access token for the MCP endpoint. The scope cannot exceed the account\'s current level (read / editor / admin). The secret is returned once.',
			tags: ['Personal Access Tokens'],
			body: createPersonalAccessTokenRequest,
			response: { 201: createPersonalAccessTokenResponse, 401: authErrorResponse, 403: authErrorResponse, 500: errorResponse },
		},
		preHandler: [fastify.verifyJwt],
		handler: async (request: FastifyRequest<{ Body: CreatePersonalAccessTokenRequest }>, reply) => {
			try {
				const account = await findUserById(fastify.mysql, request.user!.sub);

				if (!account) {
					return reply.code(401).send({ error: 'unauthorized', message: 'Account not found' });
				}

				// A leftover access JWT from before a password change/reset carries the old
				// tokenVersion; it must not mint a token that would outlive that purge.
				if (account.tokenVersion !== request.user!.tokenVersion) {
					request.log.warn({ actorFingerprint: actorFingerprint(account.userId) }, 'Personal access token creation refused: stale session');
					return reply.code(401).send({ error: 'unauthorized', message: 'Session is no longer valid' });
				}

				const level = resolveAccountLevel(account);

				if (level.banned) {
					request.log.warn({ actorFingerprint: actorFingerprint(account.userId) }, 'Personal access token creation refused: account banned');
					return reply.code(403).send({ error: 'forbidden', message: 'Account is banned' });
				}

				if (!levelAtLeast(level.level, request.body.scope)) {
					request.log.warn({ actorFingerprint: actorFingerprint(account.userId), scope: request.body.scope }, 'Personal access token creation refused: scope above account level');
					return reply.code(403).send({ error: 'forbidden', message: 'Requested scope exceeds your account rights' });
				}

				const token = generatePersonalAccessToken();
				const id = await createPersonalAccessToken(fastify.mysql, account.userId, request.body.name, hashToken(token), scopeToDb(request.body.scope));

				request.log.info({ actorFingerprint: actorFingerprint(account.userId), tokenId: id, scope: request.body.scope }, 'Personal access token created');

				return reply.code(201).send({
					id,
					name: request.body.name,
					scope: request.body.scope,
					token,
					createdAt: new Date().toISOString(),
				});
			} catch (error) {
				request.log.error(error);
				throw error;
			}
		},
	});

	fastify.delete('/tokens/:tokenId', {
		schema: {
			description: 'Revoke a personal access token owned by the authenticated user.',
			tags: ['Personal Access Tokens'],
			params: personalAccessTokenIdParam,
			response: { 204: z.void(), 401: authErrorResponse, 404: authErrorResponse, 500: errorResponse },
		},
		preHandler: [fastify.verifyJwt],
		handler: async (request: FastifyRequest<{ Params: PersonalAccessTokenIdParam }>, reply) => {
			try {
				const deleted = await deletePersonalAccessToken(fastify.mysql, request.params.tokenId, request.user!.sub);

				if (!deleted) {
					return reply.code(404).send({ error: 'not_found', message: 'Token not found' });
				}

				request.log.info({ actorFingerprint: actorFingerprint(request.user!.sub), tokenId: request.params.tokenId }, 'Personal access token revoked');
				return reply.code(204).send();
			} catch (error) {
				request.log.error(error);
				throw error;
			}
		},
	});

	fastify.log.info('[PLUGIN] Registered: patRoutes');
}
