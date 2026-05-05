import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { authPlugin } from '../auth/auth.js';
import { usersPlugin } from './users.js';
import { signAccessToken } from '../auth/jwt.js';

const mockNotifier = {
	sendActivation: vi.fn().mockResolvedValue(undefined),
	sendPasswordReset: vi.fn().mockResolvedValue(undefined),
	sendPasswordChanged: vi.fn().mockResolvedValue(undefined),
};

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
	app.decorate('authNotifier', mockNotifier);
	app.decorate('resolveOrigin', () => 'https://test.example.com');
	app.register(authPlugin);
	app.register(usersPlugin, { prefix: '/users' });

	return app;
}

const getToken = async () =>
	signAccessToken({ sub: 1, login: 'testuser', isAdmin: false, isEditor: false, tokenVersion: 0, rights: { canVote: true, canComment: true, canEditContent: false, canEditUsers: false } }, secret);

describe('PATCH /users/:userId/password', () => {
	it('returns 401 without auth token', async () => {
		const mysql = createMockMysql();
		const app = await buildApp(mysql);

		const response = await app.inject({
			method: 'PATCH',
			url: '/users/1/password',
			payload: { currentPassword: 'old', newPassword: 'newpass123' },
		});

		expect(response.statusCode).toBe(401);
	});

	it('returns 403 when changing another user password', async () => {
		const mysql = createMockMysql();
		const app = await buildApp(mysql);
		const token = await getToken();

		const response = await app.inject({
			method: 'PATCH',
			url: '/users/999/password',
			headers: { authorization: `Bearer ${token}` },
			payload: { currentPassword: 'old', newPassword: 'newpass123' },
		});

		expect(response.statusCode).toBe(403);
	});
});

describe('DELETE /users/:userId', () => {
	it('returns 401 without auth token', async () => {
		const mysql = createMockMysql();
		const app = await buildApp(mysql);

		const response = await app.inject({
			method: 'DELETE',
			url: '/users/1',
			payload: { password: 'test' },
		});

		expect(response.statusCode).toBe(401);
	});

	it('returns 403 when deleting another user', async () => {
		const mysql = createMockMysql();
		const app = await buildApp(mysql);
		const token = await getToken();

		const response = await app.inject({
			method: 'DELETE',
			url: '/users/999',
			headers: { authorization: `Bearer ${token}` },
			payload: { password: 'test' },
		});

		expect(response.statusCode).toBe(403);
	});
});

const getTokenForUser = (sub: number) =>
	signAccessToken(
		{ sub, login: `user${sub}`, isAdmin: false, isEditor: false, tokenVersion: 0,
			rights: { canVote: true, canComment: true, canEditContent: false, canEditUsers: false } },
		secret,
	);

describe('GET /users/:userId/display-name', () => {
	it('returns 403 for a different user', async () => {
		const mysql = createMockMysql();
		const app = await buildApp(mysql);
		const token = await getTokenForUser(2); // logged in as user 2, requesting user 1
		const res = await app.inject({
			method: 'GET',
			url: '/users/1/display-name',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(res.statusCode).toBe(403);
	});

	it('returns displayName for own user', async () => {
		const mysql = createMockMysql([{ displayName: 'Poetic Soul', displayNameChangedAt: null }]);
		const app = await buildApp(mysql);
		const token = await getTokenForUser(1);
		const res = await app.inject({
			method: 'GET',
			url: '/users/1/display-name',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toMatchObject({ displayName: 'Poetic Soul' });
	});
});

describe('PUT /users/:userId/display-name', () => {
	it('returns 429 when changed within 7 days', async () => {
		const recentChange = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
		const mysql = createMockMysql(
			[{ displayName: 'Old Name', displayNameChangedAt: recentChange }],
		);
		const app = await buildApp(mysql);
		const token = await getTokenForUser(1);
		const res = await app.inject({
			method: 'PUT',
			url: '/users/1/display-name',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ displayName: 'New Name' }),
		});
		expect(res.statusCode).toBe(429);
	});

	it('returns 409 when display name is reserved', async () => {
		const mysql = createMockMysql(
			[{ displayName: 'whatever', displayNameChangedAt: null }],
			[{ value: 'admin' }, { value: 'mellonis' }],
		);
		const app = await buildApp(mysql);
		const token = await getTokenForUser(1);
		const res = await app.inject({
			method: 'PUT',
			url: '/users/1/display-name',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ displayName: 'admin' }),
		});
		expect(res.statusCode).toBe(409);
	});

	it('updates display name when valid and not in cooldown', async () => {
		const mysql = createMockMysql(
			[{ displayName: 'old', displayNameChangedAt: null }],
			[],
			[{}],
		);
		const app = await buildApp(mysql);
		const token = await getTokenForUser(1);
		const res = await app.inject({
			method: 'PUT',
			url: '/users/1/display-name',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ displayName: 'New Name' }),
		});
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toMatchObject({ displayName: 'New Name' });
	});
});
