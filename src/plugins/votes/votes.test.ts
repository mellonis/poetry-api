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

	it('records a vote and returns the updated summary', async () => {
		// First mock response: upsertVote (no rows). Second: getVoteSummary
		// (which runs voteSummariesQuery internally).
		const app = await buildApp(createMockMysql([], [{ thingId: 1, likes: 3, dislikes: 1, userVote: 1 }]));
		const token = await getToken();

		const response = await app.inject({
			method: 'PUT',
			url: '/things/1/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: 'like' },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ likes: 3, dislikes: 1, userVote: 'like' });
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

	it('removes vote when vote is null and returns the updated summary', async () => {
		// deleteVote (no rows), then getVoteSummary returning userVote=0 → null.
		const app = await buildApp(createMockMysql([], [{ thingId: 1, likes: 2, dislikes: 0, userVote: 0 }]));
		const token = await getToken();

		const response = await app.inject({
			method: 'PUT',
			url: '/things/1/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: null },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ likes: 2, dislikes: 0, userVote: null });
	});
});

describe('GET /things/votes', () => {
	it('returns summaries for anonymous callers with userVote: null', async () => {
		const app = await buildApp(createMockMysql([
			{ thingId: 1, likes: '4', dislikes: '1', userVote: 0 },
			{ thingId: 2, likes: '0', dislikes: '2', userVote: 0 },
		]));

		const response = await app.inject({
			method: 'GET',
			url: '/things/votes?thingIds=1,2,3',
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			1: { likes: 4, dislikes: 1, userVote: null },
			2: { likes: 0, dislikes: 2, userVote: null },
			// 3 has no vote rows — pre-filled zero summary.
			3: { likes: 0, dislikes: 0, userVote: null },
		});
	});

	it('returns userVote for authenticated callers', async () => {
		const app = await buildApp(createMockMysql([
			{ thingId: 7, likes: '5', dislikes: '0', userVote: 1 },
		]));
		const token = await getToken();

		const response = await app.inject({
			method: 'GET',
			url: '/things/votes?thingIds=7',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			7: { likes: 5, dislikes: 0, userVote: 'like' },
		});
	});

	it('rejects an empty ids list', async () => {
		const app = await buildApp(createMockMysql());

		const response = await app.inject({
			method: 'GET',
			url: '/things/votes?thingIds=',
		});

		expect(response.statusCode).toBe(400);
	});

	it('rejects non-integer ids', async () => {
		const app = await buildApp(createMockMysql());

		const response = await app.inject({
			method: 'GET',
			url: '/things/votes?thingIds=1,abc,3',
		});

		expect(response.statusCode).toBe(400);
	});

	it('caps the ids list at 100 entries', async () => {
		const app = await buildApp(createMockMysql());
		const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(',');

		const response = await app.inject({
			method: 'GET',
			url: `/things/votes?thingIds=${ids}`,
		});

		expect(response.statusCode).toBe(400);
	});

	it('returns summaries for every thing in a section by sectionId', async () => {
		const app = await buildApp(createMockMysql([
			{ thingId: 11, likes: '2', dislikes: '1', userVote: 0 },
			{ thingId: 12, likes: '0', dislikes: '0', userVote: 0 },
			{ thingId: 13, likes: '4', dislikes: '0', userVote: 0 },
		]));

		const response = await app.inject({
			method: 'GET',
			url: '/things/votes?sectionId=nnils',
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			11: { likes: 2, dislikes: 1, userVote: null },
			12: { likes: 0, dislikes: 0, userVote: null },
			13: { likes: 4, dislikes: 0, userVote: null },
		});
	});

	it('rejects providing both ids and sectionId', async () => {
		const app = await buildApp(createMockMysql());

		const response = await app.inject({
			method: 'GET',
			url: '/things/votes?thingIds=1,2&sectionId=nnils',
		});

		expect(response.statusCode).toBe(400);
	});

	it('rejects providing neither ids nor sectionId', async () => {
		const app = await buildApp(createMockMysql());

		const response = await app.inject({
			method: 'GET',
			url: '/things/votes',
		});

		expect(response.statusCode).toBe(400);
	});

	it('rejects invalid sectionId characters', async () => {
		const app = await buildApp(createMockMysql());

		const response = await app.inject({
			method: 'GET',
			url: '/things/votes?sectionId=has spaces',
		});

		expect(response.statusCode).toBe(400);
	});
});
