import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { authPlugin } from '../auth.js';
import { patRoutesPlugin } from './patRoutes.js';
import { hashToken, signAccessToken } from '../jwt.js';

const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
const secret = new TextEncoder().encode(JWT_SECRET);

beforeEach(() => {
	vi.stubEnv('JWT_SECRET', JWT_SECRET);
	vi.stubEnv('JWT_ACCESS_TOKEN_TTL', '900');
	vi.stubEnv('JWT_REFRESH_TOKEN_TTL', '2592000');
	vi.stubEnv('ACTIVATION_KEY_TTL', '86400');
	vi.stubEnv('RESET_KEY_TTL', '3600');
});

function createRecordingMysql(...responses: unknown[]) {
	let callIndex = 0;
	const calls: { sql: string; params: unknown[] }[] = [];
	const pool = {
		getConnection: vi.fn().mockImplementation(() =>
			Promise.resolve({
				query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
					calls.push({ sql, params: params ?? [] });
					return Promise.resolve([responses[callIndex++] ?? []]);
				}),
				release: vi.fn(),
			}),
		),
	} as unknown as MySQLPromisePool;
	return { pool, calls };
}

async function buildApp(mysql: MySQLPromisePool) {
	const app = Fastify({ logger: false });
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.decorate('mysql', mysql);
	await app.register(authPlugin);
	await app.register(patRoutesPlugin, { prefix: '/auth' });
	return app;
}

const noRights = { canVote: false, canComment: false, canEditContent: false, canEditUsers: false };

const editorJwt = () => signAccessToken(
	{ sub: 3, login: 'ed', isAdmin: false, isEditor: true, tokenVersion: 0, rights: { ...noRights, canVote: true, canComment: true, canEditContent: true } },
	secret,
);

// v_users_info row for login 'ed': editor group, no overrides.
const editorUserRow = {
	user_id: 3, user_login: 'ed', user_password: 'x', user_email: 'ed@example.test', user_rights: 25,
	user_key: null, group_id: 2, group_rights: 14336, token_version: 0,
};

describe('POST /auth/tokens', () => {
	it('requires a session', async () => {
		const app = await buildApp(createRecordingMysql().pool);
		const res = await app.inject({ method: 'POST', url: '/auth/tokens', payload: { name: 'x', scope: 'read' } });
		expect(res.statusCode).toBe(401);
	});

	it('creates a token at or below the account level and returns the raw token once', async () => {
		const { pool, calls } = createRecordingMysql([editorUserRow], { insertId: 11 });
		const app = await buildApp(pool);
		const res = await app.inject({
			method: 'POST', url: '/auth/tokens',
			headers: { authorization: `Bearer ${await editorJwt()}` },
			payload: { name: 'Claude Code', scope: 'editor' },
		});
		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body).toMatchObject({ id: 11, name: 'Claude Code', scope: 'editor' });
		expect(body.token).toMatch(/^pat_[A-Za-z0-9_-]{43}$/);
		expect(typeof body.createdAt).toBe('string');
		const insert = calls.find((c) => /INSERT INTO auth_personal_access_token/.test(c.sql))!;
		expect(insert.params[2]).toMatch(/^[0-9a-f]{64}$/);           // hash, not the token
		expect(insert.params[2]).toBe(hashToken(body.token));
		expect(insert.params[3]).toBe(2);
		expect(calls[0].sql).toMatch(/WHERE user_id = \?/);
		expect(calls[0].params).toEqual([3]);
	});

	it('refuses a stale session (tokenVersion mismatch) with 401 and no INSERT', async () => {
		const { pool, calls } = createRecordingMysql([{ ...editorUserRow, token_version: 1 }]);
		const app = await buildApp(pool);
		const res = await app.inject({
			method: 'POST', url: '/auth/tokens',
			headers: { authorization: `Bearer ${await editorJwt()}` },
			payload: { name: 'x', scope: 'read' },
		});
		expect(res.statusCode).toBe(401);
		expect(res.json()).toEqual({ error: 'unauthorized', message: 'Session is no longer valid' });
		expect(calls.some((c) => /INSERT/.test(c.sql))).toBe(false);
	});

	it('refuses when the account no longer exists with 401', async () => {
		const { pool, calls } = createRecordingMysql([]);
		const app = await buildApp(pool);
		const res = await app.inject({
			method: 'POST', url: '/auth/tokens',
			headers: { authorization: `Bearer ${await editorJwt()}` },
			payload: { name: 'x', scope: 'read' },
		});
		expect(res.statusCode).toBe(401);
		expect(res.json()).toEqual({ error: 'unauthorized', message: 'Account not found' });
		expect(calls.some((c) => /INSERT/.test(c.sql))).toBe(false);
	});

	it('refuses a scope above the account level with 403', async () => {
		const { pool, calls } = createRecordingMysql([editorUserRow]);
		const app = await buildApp(pool);
		const res = await app.inject({
			method: 'POST', url: '/auth/tokens',
			headers: { authorization: `Bearer ${await editorJwt()}` },
			payload: { name: 'too much', scope: 'admin' },
		});
		expect(res.statusCode).toBe(403);
		expect(res.json().error).toBe('forbidden');
		expect(calls.some((c) => /INSERT/.test(c.sql))).toBe(false);
	});

	it('rejects an unknown scope with 400', async () => {
		const app = await buildApp(createRecordingMysql([editorUserRow]).pool);
		const res = await app.inject({
			method: 'POST', url: '/auth/tokens',
			headers: { authorization: `Bearer ${await editorJwt()}` },
			payload: { name: 'x', scope: 'root' },
		});
		expect(res.statusCode).toBe(400);
	});

	it('refuses a banned account with 403', async () => {
		const bannedUserRow = { ...editorUserRow, user_rights: 25 | 4 };
		const { pool, calls } = createRecordingMysql([bannedUserRow]);
		const app = await buildApp(pool);
		const res = await app.inject({
			method: 'POST', url: '/auth/tokens',
			headers: { authorization: `Bearer ${await editorJwt()}` },
			payload: { name: 'x', scope: 'read' },
		});
		expect(res.statusCode).toBe(403);
		expect(res.json().error).toBe('forbidden');
		expect(calls.some((c) => /INSERT/.test(c.sql))).toBe(false);
	});
});

describe('GET /auth/tokens', () => {
	it('lists the caller tokens without hashes', async () => {
		const { pool, calls } = createRecordingMysql([
			{ id: 1, name: 'laptop', scope: 1, created_at: new Date('2026-09-25T10:00:00Z'), last_used_at: new Date('2026-09-26T10:00:00Z') },
		]);
		const app = await buildApp(pool);
		const res = await app.inject({ method: 'GET', url: '/auth/tokens', headers: { authorization: `Bearer ${await editorJwt()}` } });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual([{ id: 1, name: 'laptop', scope: 'read', createdAt: '2026-09-25T10:00:00.000Z', lastUsedAt: '2026-09-26T10:00:00.000Z' }]);
		expect(calls[0].params).toEqual([3]);
	});
});

describe('DELETE /auth/tokens/:tokenId', () => {
	it('deletes an own token → 204', async () => {
		const { pool, calls } = createRecordingMysql({ affectedRows: 1 });
		const app = await buildApp(pool);
		const res = await app.inject({ method: 'DELETE', url: '/auth/tokens/5', headers: { authorization: `Bearer ${await editorJwt()}` } });
		expect(res.statusCode).toBe(204);
		expect(calls[0].params).toEqual([5, 3]);
	});

	it('answers 404 for a token that is not the caller\'s', async () => {
		const app = await buildApp(createRecordingMysql({ affectedRows: 0 }).pool);
		const res = await app.inject({ method: 'DELETE', url: '/auth/tokens/5', headers: { authorization: `Bearer ${await editorJwt()}` } });
		expect(res.statusCode).toBe(404);
	});
});
