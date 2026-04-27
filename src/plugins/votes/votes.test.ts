import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { authPlugin } from '../auth/auth.js';
import { votesPlugin } from './votes.js';
import { signAccessToken } from '../auth/jwt.js';

const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
const secret = new TextEncoder().encode(JWT_SECRET);

beforeEach(() => {
	vi.stubEnv('JWT_SECRET', JWT_SECRET);
	vi.stubEnv('JWT_ACCESS_TOKEN_TTL', '900');
	vi.stubEnv('JWT_REFRESH_TOKEN_TTL', '2592000');
	vi.stubEnv('ACTIVATION_KEY_TTL', '86400');
	vi.stubEnv('RESET_KEY_TTL', '3600');
});

function createMockMysql(...responses: Record<string, unknown>[][]): MySQLPromisePool {
	let callIndex = 0;

	return {
		getConnection: vi.fn().mockImplementation(() =>
			Promise.resolve({
				query: vi.fn().mockResolvedValue([responses[callIndex++] ?? []]),
				release: vi.fn(),
			})
		),
	} as unknown as MySQLPromisePool;
}

async function buildApp(mysql: MySQLPromisePool) {
	const app = Fastify({ logger: false });

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.decorate('mysql', mysql);
	app.register(authPlugin);
	app.register(votesPlugin, { prefix: '/things' });

	return app;
}

const getToken = async (canVote = true) =>
	signAccessToken({ sub: 1, login: 'testuser', isAdmin: false, isEditor: false, tokenVersion: 0, rights: { canVote, canComment: true, canEditContent: false, canEditUsers: false } }, secret);

describe('PUT /things/:thingId/vote', () => {
	it('returns 401 without auth token', async () => {
		const app = await buildApp(createMockMysql());

		const response = await app.inject({
			method: 'PUT',
			url: '/things/1/vote',
			payload: { vote: 'like' },
		});

		expect(response.statusCode).toBe(401);
	});

	it('returns 403 when user lacks canVote right', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getToken(false);

		const response = await app.inject({
			method: 'PUT',
			url: '/things/1/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: 'like' },
		});

		expect(response.statusCode).toBe(403);
	});

	it('records a vote and returns updated counts', async () => {
		const app = await buildApp(createMockMysql([], [{ plus: 3, minus: 1 }]));
		const token = await getToken();

		const response = await app.inject({
			method: 'PUT',
			url: '/things/1/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: 'like' },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ plus: 3, minus: 1 });
	});

	it('rejects invalid vote values', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getToken();

		const response = await app.inject({
			method: 'PUT',
			url: '/things/1/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: 'shrug' as unknown as 'like' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('removes vote when vote is null and returns updated counts', async () => {
		const app = await buildApp(createMockMysql([], [{ plus: 2, minus: 0 }]));
		const token = await getToken();

		const response = await app.inject({
			method: 'PUT',
			url: '/things/1/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: null },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ plus: 2, minus: 0 });
	});
});
