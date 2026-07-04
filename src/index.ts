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
import { isRateLimitExempt } from './plugins/auth/rateLimitAllowList.js';

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);

// Same secret encoding as auth.ts (which validates JWT_SECRET at startup).
const jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET ?? '');

const fastify: FastifyInstance = Fastify({
	logger: process.env.NODE_ENV === 'production'
		? {
			// Match the JSON log shape emitted by poetry-nextjs and poetry-old2 so
			// the three services share one canonical line format for downstream
			// tooling (dozzle, log aggregators):
			//   {"time":"<iso>","level":"info","reqId":"…","msg":"…"}
			// Pino's defaults emit numeric levels (30/40/…), unix-ms time, and
			// per-line pid+hostname — none of which match the rest of the stack.
			formatters: { level: (label) => ({ level: label }) },
			timestamp: () => `,"time":"${new Date().toISOString()}"`,
			base: null,
		}
		: { transport: { target: 'pino-pretty' } },
	genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
	// Trust exactly one proxy hop (nginx). Makes request.ip the real client
	// IP from X-Forwarded-For so per-IP rate limiting works; `1` (not `true`)
	// prevents a client from spoofing X-Forwarded-For to evade the limit.
	trustProxy: 1,
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
// `allowList` lets verified editors/admins bypass rate-limiting. The token
// signature MUST be verified here, not just decoded: some rate-limited routes
// (e.g. POST /setup/admin, gated only by a body secret) never run verifyJwt,
// so a forged "isAdmin: true" payload would otherwise skip the limiter and
// keep brute-forcing. Verifying the signature makes the skip trustworthy on
// its own, independent of whether the route runs verifyJwt.
fastify.register(rateLimit, {
	global: false,
	// English message + stable `error` code, matching the rest of poetry-api;
	// clients localize from the code. `ttl` is surfaced for a countdown UI.
	errorResponseBuilder: (_req, ctx) => ({
		statusCode: 429,
		error: 'rate_limited',
		message: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)}s.`,
	}),
	allowList: (request) => isRateLimitExempt(request, jwtSecret),
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
