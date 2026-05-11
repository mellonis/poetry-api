import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { sectionsPlugin } from './plugins/sections/sections.js';
import { databasePlugin } from './plugins/database/database.js';
import { swaggerPlugin } from './plugins/swagger/swagger.js';
import { thingsOfTheDayPlugin } from './plugins/thingsOfTheDay/thingsOfTheDay.js';
import { authPlugin } from './plugins/auth/auth.js';
import { authRoutesPlugin } from './plugins/auth/authRoutes.js';
import { passkeyRoutesPlugin } from './plugins/auth/passkey/passkeyRoutes.js';
import { usersPlugin } from './plugins/users/users.js';
import { authNotifierPlugin } from './plugins/authNotifier/authNotifier.js';
import { votesPlugin } from './plugins/votes/votes.js';
import { bookmarksPlugin } from './plugins/bookmarks/bookmarks.js';
import { authorPlugin } from './plugins/author/author.js';
import { cmsPlugin } from './plugins/cms/cms.js';
import { commentsPlugin } from './plugins/comments/comments.js';
import searchPlugin from './plugins/search/search.js';
import { searchRoutes } from './plugins/search/searchRoutes.js';
import { healthPlugin } from './plugins/health/health.js';
import { setupPlugin } from './plugins/setup/setup.js';

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);

const fastify: FastifyInstance = Fastify({
	logger: process.env.NODE_ENV === 'production'
		? true
		: { transport: { target: 'pino-pretty' } },
	genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
});

fastify.addHook('onSend', async (request, reply) => {
	reply.header('X-Request-Id', request.id);
});

fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

fastify.register(cors, {
	origin: allowedOrigins,
	methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
	allowedHeaders: ['Content-Type', 'Authorization'],
	// Expose Retry-After so the browser lets JS read it on 429 responses
	// (clients use it for the rate-limit countdown UI). X-Request-Id is
	// already set by us for tracing — exposing it lets clients echo it back.
	exposedHeaders: ['Retry-After', 'X-Request-Id'],
	credentials: true,
});
// Global rate limit is opt-in per route via `config: { rateLimit }`.
// Keyed by IP — the rate-limit hook runs before verifyJwt, so request.user
// is not yet populated; auth-gated routes still get the auth check on top.
// errorResponseBuilder localizes the 429 body for our (Russian) clients.
//
// `skip` decodes the JWT to bypass rate-limiting for editors/admins. Decode
// only — signature is NOT verified here (verifyJwt does that later). A forged
// "isEditor: true" token would still fail verifyJwt and never reach the
// handler, so the skip is safe to base on the unverified payload.
fastify.register(rateLimit, {
	global: false,
	errorResponseBuilder: (_req, ctx) => ({
		statusCode: 429,
		error: 'rate_limited',
		message: `Слишком часто. Попробуйте через ${Math.ceil(ctx.ttl / 1000)} с.`,
	}),
	allowList: (request) => {
		const auth = request.headers.authorization;

		if (!auth?.startsWith('Bearer ')) return false;

		try {
			const part = auth.substring(7).split('.')[1];

			if (!part) return false;

			const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
				isEditor?: boolean;
				isAdmin?: boolean;
			};

			return payload.isEditor === true || payload.isAdmin === true;
		} catch {
			return false;
		}
	},
});
fastify.register(databasePlugin);
fastify.register(healthPlugin);
fastify.register(setupPlugin);
fastify.register(searchPlugin);
fastify.register(authPlugin);
fastify.register(authNotifierPlugin);
fastify.register(swaggerPlugin);
fastify.register(sectionsPlugin, { prefix: '/sections' });
fastify.register(thingsOfTheDayPlugin, { prefix: '/things-of-the-day' });
fastify.register(authRoutesPlugin, { prefix: '/auth' });
fastify.register(passkeyRoutesPlugin, { prefix: '/auth' });
fastify.register(usersPlugin, { prefix: '/users' });
fastify.register(votesPlugin, { prefix: '/things' });
fastify.register(bookmarksPlugin, { prefix: '/bookmarks' });
fastify.register(authorPlugin, { prefix: '/author' });
fastify.register(cmsPlugin, { prefix: '/cms' });
fastify.register(commentsPlugin, { prefix: '/comments' });
fastify.register(searchRoutes, { prefix: '/search' });

async function main() {
	await fastify.listen({
		host: '0.0.0.0',
		port: process.env.PORT ? Number(process.env.PORT) : 3000,
	});
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
	process.on(signal, async () => {
		await fastify.close();

		process.exit(0);
	});
});

main()
	.catch((error) => {
		fastify.log.error(error);
		process.exit(1);
	});
