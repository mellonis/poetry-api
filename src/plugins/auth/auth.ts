import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { AccessTokenPayload } from './jwt.js';
import { verifyAccessToken } from './jwt.js';
import type { ResolvedRights } from './rights.js';

declare module 'fastify' {
	interface FastifyInstance {
		verifyJwt: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
		optionalVerifyJwt: (request: FastifyRequest) => Promise<void>;
		requireRight: (right: keyof ResolvedRights) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
	}
	interface FastifyRequest {
		user: AccessTokenPayload | null;
	}
}

const MIN_SECRET_LENGTH = 32;

const requirePositiveIntEnv = (envName: string): void => {
	const value = process.env[envName];
	if (!value) {
		throw new Error(`${envName} environment variable is not set`);
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${envName} must be a positive integer (seconds)`);
	}
};

const authPlugin = fastifyPlugin(async (fastify: FastifyInstance) => {
	fastify.log.info('[PLUGIN] Registering: auth...');

	const jwtSecret = process.env.JWT_SECRET;

	if (!jwtSecret || jwtSecret.length < MIN_SECRET_LENGTH) {
		throw new Error(`JWT_SECRET environment variable must be at least ${MIN_SECRET_LENGTH} characters`);
	}

	requirePositiveIntEnv('JWT_ACCESS_TOKEN_TTL');
	requirePositiveIntEnv('JWT_REFRESH_TOKEN_TTL');
	requirePositiveIntEnv('ACTIVATION_KEY_TTL');
	requirePositiveIntEnv('RESET_KEY_TTL');

	const secret = new TextEncoder().encode(jwtSecret);

	fastify.decorateRequest('user', null);

	fastify.decorate('verifyJwt', async (request: FastifyRequest, reply: FastifyReply) => {
		const authorization = request.headers.authorization;

		if (!authorization?.startsWith('Bearer ')) {
			return reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid Authorization header' });
		}

		const token = authorization.substring(7);

		try {
			request.user = await verifyAccessToken(token, secret);
		} catch {
			return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or expired token' });
		}
	});

	fastify.decorate('optionalVerifyJwt', async (request: FastifyRequest) => {
		const authorization = request.headers.authorization;

		if (!authorization?.startsWith('Bearer ')) {
			return;
		}

		const token = authorization.substring(7);

		try {
			request.user = await verifyAccessToken(token, secret);
		} catch {
			// invalid token — proceed as unauthenticated
		}
	});

	fastify.decorate('requireRight', (right: keyof ResolvedRights) =>
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!request.user?.rights[right]) {
				return reply.code(403).send({ error: 'forbidden', message: `Missing required right: ${right}` });
			}
		},
	);

	fastify.log.info('[PLUGIN] Registered: auth');
});

export { authPlugin };
