import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { authPlugin } from './auth.js';
import { authRoutesPlugin } from './authRoutes.js';
import bcrypt from 'bcryptjs';

const mockNotifier = {
	sendActivation: vi.fn().mockResolvedValue(undefined),
	sendPasswordReset: vi.fn().mockResolvedValue(undefined),
	sendPasswordChanged: vi.fn().mockResolvedValue(undefined),
};

const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';

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

function buildApp(mysql: MySQLPromisePool) {
	const app = Fastify({ logger: false });

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.decorate('mysql', mysql);
	app.decorate('authNotifier', mockNotifier);
	app.decorate('resolveOrigin', () => 'https://test.example.com');
	app.register(authPlugin);
	app.register(authRoutesPlugin, { prefix: '/auth' });

	return app;
}

const bcryptHash = bcrypt.hashSync('password123', 10);

const activeUserRow = {
	user_id: 1,
	user_login: 'testuser',
	user_password: bcryptHash,
	user_email: 'test@example.com',
	user_rights: 25, // 24 (canVote + canComment) + 1 (emailActivated)
	user_key: null,
	group_id: 3,
	group_rights: 0,
	token_version: 0,
};

describe('POST /auth/login', () => {
	it('returns tokens for valid credentials', async () => {
		const mysql = createMockMysql([activeUserRow], [], []);
		const app = buildApp(mysql);

		const response = await app.inject({
			method: 'POST',
			url: '/auth/login',
			payload: { login: 'testuser', password: 'password123' },
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.accessToken).toBeDefined();
		expect(body.refreshToken).toBeDefined();
		expect(body.user.id).toBe(1);
		expect(body.user.login).toBe('testuser');
		expect(body.user.rights).toEqual({ canVote: true, canComment: true, canEditContent: false, canEditUsers: false });
	});

	it('returns 401 for wrong password', async () => {
		const mysql = createMockMysql([activeUserRow]);
		const app = buildApp(mysql);

		const response = await app.inject({
			method: 'POST',
			url: '/auth/login',
			payload: { login: 'testuser', password: 'wrongpassword' },
		});

		expect(response.statusCode).toBe(401);
		expect(response.json().error).toBe('invalid_credentials');
	});

	it('returns 401 for non-existent user', async () => {
		const mysql = createMockMysql([]);
		const app = buildApp(mysql);

		const response = await app.inject({
			method: 'POST',
			url: '/auth/login',
			payload: { login: 'nobody', password: 'password123' },
		});

		expect(response.statusCode).toBe(401);
		expect(response.json().error).toBe('invalid_credentials');
	});

	it('returns 403 for banned user', async () => {
		const bannedUser = { ...activeUserRow, user_rights: 29 }; // 25 + 4 (banned)
		const mysql = createMockMysql([bannedUser]);
		const app = buildApp(mysql);

		const response = await app.inject({
			method: 'POST',
			url: '/auth/login',
			payload: { login: 'testuser', password: 'password123' },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json().error).toBe('account_banned');
	});

	it('returns 403 for not-activated user', async () => {
		const inactiveUser = { ...activeUserRow, user_rights: 24 }; // no emailActivated bit
		const mysql = createMockMysql([inactiveUser]);
		const app = buildApp(mysql);

		const response = await app.inject({
			method: 'POST',
			url: '/auth/login',
			payload: { login: 'testuser', password: 'password123' },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json().error).toBe('account_not_activated');
	});
});

describe('POST /auth/logout', () => {
	it('returns 204 on logout', async () => {
		const mysql = createMockMysql([{ id: 1, r_user_id: 1 }], []);
		const app = buildApp(mysql);

		const response = await app.inject({
			method: 'POST',
			url: '/auth/logout',
			payload: { refreshToken: 'a'.repeat(64) },
		});

		expect(response.statusCode).toBe(204);
	});
});

describe('POST /auth/register', () => {
	it('returns 201 with message for new user', async () => {
		const mysql = createMockMysql([], [{ insertId: 42 }]);
		const app = buildApp(mysql);

		const response = await app.inject({
			method: 'POST',
			url: '/auth/register',
			payload: { login: 'newuser', password: 'password123', email: 'new@example.com' },
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().message).toBeDefined();
	});

	it('returns 409 when login is taken', async () => {
		const mysql = createMockMysql([activeUserRow]);
		const app = buildApp(mysql);

		const response = await app.inject({
			method: 'POST',
			url: '/auth/register',
			payload: { login: 'testuser', password: 'password123', email: 'new@example.com' },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().error).toBe('invalid_input');
	});
});

describe('GET /auth/me', () => {
	it('returns the verified user payload for a valid token', async () => {
		const mysql = createMockMysql([activeUserRow], [], []);
		const app = buildApp(mysql);

		const login = await app.inject({
			method: 'POST',
			url: '/auth/login',
			payload: { login: 'testuser', password: 'password123' },
		});
		const { accessToken } = login.json();

		const response = await app.inject({
			method: 'GET',
			url: '/auth/me',
			headers: { authorization: `Bearer ${accessToken}` },
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body).toEqual({
			id: 1,
			login: 'testuser',
			isAdmin: false,
			isEditor: false,
			rights: { canVote: true, canComment: true, canEditContent: false, canEditUsers: false },
		});
	});

	it('returns 401 when Authorization header is missing', async () => {
		const mysql = createMockMysql();
		const app = buildApp(mysql);

		const response = await app.inject({ method: 'GET', url: '/auth/me' });

		expect(response.statusCode).toBe(401);
		expect(response.json()).toEqual({ error: 'unauthorized', message: 'Missing or invalid Authorization header' });
	});

	it('returns 401 for a malformed token', async () => {
		const mysql = createMockMysql();
		const app = buildApp(mysql);

		const response = await app.inject({
			method: 'GET',
			url: '/auth/me',
			headers: { authorization: 'Bearer not-a-real-jwt' },
		});

		expect(response.statusCode).toBe(401);
		expect(response.json()).toEqual({ error: 'unauthorized', message: 'Invalid or expired token' });
	});

	it('reflects canEditContent=true for an editor', async () => {
		// editor group: rights 14336 = bits 11+12+13 (edit_votes + edit_things + edit_news)
		const editorRow = { ...activeUserRow, group_id: 2, group_rights: 14336 };
		const mysql = createMockMysql([editorRow], [], []);
		const app = buildApp(mysql);

		const login = await app.inject({
			method: 'POST',
			url: '/auth/login',
			payload: { login: 'testuser', password: 'password123' },
		});
		const { accessToken } = login.json();

		const response = await app.inject({
			method: 'GET',
			url: '/auth/me',
			headers: { authorization: `Bearer ${accessToken}` },
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.isEditor).toBe(true);
		expect(body.rights.canEditContent).toBe(true);
	});
});
