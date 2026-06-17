import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { authPlugin } from '../auth/auth.js';
import { notificationsPlugin } from './notifications.js';
import { signAccessToken } from '../auth/jwt.js';

const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
const secret = new TextEncoder().encode(JWT_SECRET);

beforeEach(() => {
	vi.stubEnv('JWT_SECRET', JWT_SECRET);
	vi.stubEnv('JWT_ACCESS_TOKEN_TTL', '900');
	vi.stubEnv('JWT_REFRESH_TOKEN_TTL', '2592000');
	vi.stubEnv('ACTIVATION_KEY_TTL', '86400');
	vi.stubEnv('RESET_KEY_TTL', '3600');
	vi.stubEnv('ALLOWED_ORIGINS', 'https://poetry.mellonis.ru');
});

// Each rest arg is the "first element of one query result tuple": a row array
// for SELECT (e.g. `[{cnt: 5}]`) or a result-set header object for UPDATE/
// DELETE (e.g. `{affectedRows: 1}`). The mock wraps it in `[…]` so the helper's
// `const [x] = await query(...)` destructure strips one level back to the arg.
function createMockMysql(...responses: unknown[]): MySQLPromisePool {
	let queryIndex = 0;
	return {
		getConnection: vi.fn().mockImplementation(() =>
			Promise.resolve({
				query: vi.fn().mockImplementation(() =>
					Promise.resolve([responses[queryIndex++] ?? []]),
				),
				release: vi.fn(),
			}),
		),
	} as unknown as MySQLPromisePool;
}

async function buildApp(mysql: MySQLPromisePool) {
	const app = Fastify({ logger: false });
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.decorate('mysql', mysql);
	app.register(authPlugin);
	app.register(notificationsPlugin, { prefix: '/notifications' });
	await app.ready();
	return app;
}

const buildToken = (sub: number = 1) =>
	signAccessToken({
		sub,
		login: 'testuser',
		isAdmin: false,
		isEditor: false,
		tokenVersion: 0,
		rights: {
			canVote: true,
			canComment: true,
			canEditContent: false,
			canEditUsers: false,
		},
	}, secret);

describe('GET /notifications/summary', () => {
	it('returns 401 without auth', async () => {
		const app = await buildApp(createMockMysql());
		const response = await app.inject({ method: 'GET', url: '/notifications/summary' });
		expect(response.statusCode).toBe(401);
	});

	it('returns the unread count for the authenticated user', async () => {
		const app = await buildApp(createMockMysql([{ cnt: 5 }]));
		const token = await buildToken();
		const response = await app.inject({
			method: 'GET',
			url: '/notifications/summary',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ unreadCount: 5 });
	});

	it('returns 0 when the recipient has nothing', async () => {
		const app = await buildApp(createMockMysql([]));
		const token = await buildToken();
		const response = await app.inject({
			method: 'GET',
			url: '/notifications/summary',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ unreadCount: 0 });
	});
});

describe('GET /notifications', () => {
	const baseRow = {
		id: 100,
		typeId: 2,
		typeCode: 'comment_vote' as const,
		eventCount: 3,
		isRead: 0,
		createdAt: new Date('2026-05-15T10:00:00Z'),
		updatedAt: new Date('2026-05-16T10:00:00Z'),
		subjectId: 50,
		subjectText: 'My comment',
		threadCommentId: 50,
		subjectThingId: 7,
		objectId: null,
		objectText: null,
		objectAuthorUserId: null,
		objectAuthorDisplayName: null,
		sectionIdentifier: 'sec',
		positionInSection: 3,
	};

	it('returns 401 without auth', async () => {
		const app = await buildApp(createMockMysql());
		const response = await app.inject({ method: 'GET', url: '/notifications' });
		expect(response.statusCode).toBe(401);
	});

	it('returns items with nextCursor null when fewer than limit+1 rows', async () => {
		const app = await buildApp(createMockMysql([baseRow]));
		const token = await buildToken();
		const response = await app.inject({
			method: 'GET',
			url: '/notifications?limit=20',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.nextCursor).toBeNull();
		expect(body.items).toHaveLength(1);
		expect(body.items[0].type).toBe('comment_vote');
		expect(body.items[0].objectComment).toBeNull();
	});

	it('emits a nextCursor when there are limit+1 rows', async () => {
		const second = { ...baseRow, id: 99, updatedAt: new Date('2026-05-14T10:00:00Z') };
		const app = await buildApp(createMockMysql([baseRow, second]));
		const token = await buildToken();
		const response = await app.inject({
			method: 'GET',
			url: '/notifications?limit=1',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.items).toHaveLength(1);
		expect(body.nextCursor).not.toBeNull();
	});

	it('projects an objectComment for a reply row', async () => {
		const reply = {
			...baseRow,
			typeId: 1,
			typeCode: 'comment_reply' as const,
			eventCount: 1,
			objectId: 200,
			objectText: 'Reply text',
			objectAuthorUserId: 2,
			objectAuthorDisplayName: 'replier',
		};
		const app = await buildApp(createMockMysql([reply]));
		const token = await buildToken();
		const response = await app.inject({
			method: 'GET',
			url: '/notifications',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.items[0].type).toBe('comment_reply');
		expect(body.items[0].objectComment).toEqual({
			id: 200,
			text: 'Reply text',
			authorDisplayName: 'replier',
			authorIsAuthor: false,
		});
	});
});

describe('POST /notifications/:id/read', () => {
	it('returns 401 without auth', async () => {
		const app = await buildApp(createMockMysql());
		const response = await app.inject({ method: 'POST', url: '/notifications/1/read' });
		expect(response.statusCode).toBe(401);
	});

	it('marks the row read', async () => {
		const app = await buildApp(createMockMysql({ affectedRows: 1 }));
		const token = await buildToken();
		const response = await app.inject({
			method: 'POST',
			url: '/notifications/1/read',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ ok: true });
	});

	it("returns 404 when the row is not the caller's (or does not exist)", async () => {
		const app = await buildApp(createMockMysql({ affectedRows: 0 }));
		const token = await buildToken();
		const response = await app.inject({
			method: 'POST',
			url: '/notifications/999/read',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(404);
	});
});

describe('POST /notifications/read-all', () => {
	it('returns the count marked', async () => {
		const app = await buildApp(createMockMysql({ affectedRows: 4 }));
		const token = await buildToken();
		const response = await app.inject({
			method: 'POST',
			url: '/notifications/read-all',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ ok: true, marked: 4 });
	});
});

describe('DELETE /notifications/:id', () => {
	it('deletes the row', async () => {
		const app = await buildApp(createMockMysql({ affectedRows: 1 }));
		const token = await buildToken();
		const response = await app.inject({
			method: 'DELETE',
			url: '/notifications/1',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ ok: true });
	});

	it("returns 404 when the row is not the caller's", async () => {
		const app = await buildApp(createMockMysql({ affectedRows: 0 }));
		const token = await buildToken();
		const response = await app.inject({
			method: 'DELETE',
			url: '/notifications/999',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(404);
	});
});

describe('GET /notifications/settings', () => {
	it('returns the current settings', async () => {
		const app = await buildApp(createMockMysql(
			[{ notify_author_on_comment_reply: 1, notify_author_on_comment_vote: 0 }],
		));
		const token = await buildToken();
		const response = await app.inject({
			method: 'GET',
			url: '/notifications/settings',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			notifyAuthorOnCommentReply: true,
			notifyAuthorOnCommentVote: false,
		});
	});
});

describe('PUT /notifications/settings', () => {
	it('updates and returns the new settings', async () => {
		const app = await buildApp(createMockMysql(
			{ affectedRows: 1 },
			[{ notify_author_on_comment_reply: 0, notify_author_on_comment_vote: 1 }],
		));
		const token = await buildToken();
		const response = await app.inject({
			method: 'PUT',
			url: '/notifications/settings',
			headers: { authorization: `Bearer ${token}` },
			payload: { notifyAuthorOnCommentReply: false, notifyAuthorOnCommentVote: true },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			notifyAuthorOnCommentReply: false,
			notifyAuthorOnCommentVote: true,
		});
	});
});
