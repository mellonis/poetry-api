import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { authPlugin } from '../auth/auth.js';
import { authNotifierPlugin } from '../authNotifier/authNotifier.js';
import { commentsPlugin } from './comments.js';
import { signAccessToken } from '../auth/jwt.js';

vi.mock('../../lib/email.js', () => ({
	sendEmail: vi.fn().mockResolvedValue(undefined),
}));

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

// listComments runs multiple queries on one connection, so the mock advances
// per query call rather than per getConnection (which is the simpler pattern
// used by votes.test.ts where each route call does a single query).
// beginTransaction/commit/rollback stubs are needed for the notifications
// helper (upsertVoteNotification) which runs inside a transaction.
// `sqlLog` is attached to the returned pool so tests can assert the cumulative
// stream of executed SQL across all acquired connections (handy for the
// fire-and-forget notification helpers, which run on their own connection).
type MockMysqlPool = MySQLPromisePool & { __sqlLog: string[] };

function createMockMysql(...responses: (Record<string, unknown>[] | Record<string, unknown>)[]): MockMysqlPool {
	let queryIndex = 0;
	const sqlLog: string[] = [];

	const pool = {
		getConnection: vi.fn().mockImplementation(() =>
			Promise.resolve({
				query: vi.fn().mockImplementation((sql: string) => {
					sqlLog.push(sql);
					return Promise.resolve([responses[queryIndex++] ?? []]);
				}),
				beginTransaction: vi.fn().mockResolvedValue(undefined),
				commit: vi.fn().mockResolvedValue(undefined),
				rollback: vi.fn().mockResolvedValue(undefined),
				release: vi.fn(),
			})
		),
		__sqlLog: sqlLog,
	} as unknown as MockMysqlPool;

	return pool;
}

async function buildApp(mysql: MySQLPromisePool) {
	const app = Fastify({ logger: false });
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.decorate('mysql', mysql);
	app.register(authPlugin);
	app.register(authNotifierPlugin);
	app.register(commentsPlugin, { prefix: '/comments' });
	return app;
}

const buildToken = (overrides: Partial<{ canVote: boolean; canComment: boolean; sub: number }> = {}) =>
	signAccessToken({
		sub: overrides.sub ?? 1,
		login: 'testuser',
		isAdmin: false,
		isEditor: false,
		tokenVersion: 0,
		rights: {
			canVote: overrides.canVote ?? true,
			canComment: overrides.canComment ?? true,
			canEditContent: false,
			canEditUsers: false,
		},
	}, secret);

const visibleRow = {
	id: 10,
	parentId: null,
	thingId: 5,
	userId: 1,
	authorDisplayName: 'testuser',
	isAuthor: 1,
	text: 'Hello world',
	statusId: 1,
	createdAt: new Date('2026-04-27T12:00:00Z'),
	updatedAt: new Date('2026-04-27T12:00:00Z'),
	likes: 0,
	dislikes: 0,
	userVote: 0,
	hasVisibleChild: 0,
};

describe('GET /comments', () => {
	it('lists comments for a thing without auth', async () => {
		const mysql = createMockMysql([visibleRow], [{ total: 1 }], []);
		const app = await buildApp(mysql);

		const response = await app.inject({ method: 'GET', url: '/comments?thingId=5' });

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.items).toHaveLength(1);
		expect(body.items[0].text).toBe('Hello world');
		expect(body.total).toBe(1);
	});

	it('rejects combining thingId with scope=site', async () => {
		const app = await buildApp(createMockMysql());
		const response = await app.inject({ method: 'GET', url: '/comments?thingId=5&scope=site' });
		expect(response.statusCode).toBe(400);
	});

	it('omits text/author for tombstone top-level rows that have no visible children', async () => {
		const tombstone = { ...visibleRow, statusId: 3, hasVisibleChild: 0 };
		const mysql = createMockMysql([tombstone], [{ total: 0 }]);
		const app = await buildApp(mysql);

		const response = await app.inject({ method: 'GET', url: '/comments?thingId=5' });
		expect(response.statusCode).toBe(200);
		expect(response.json().items).toHaveLength(0);
	});

	it('includes tombstone top-level row when it has visible children, with text masked', async () => {
		const tombstone = { ...visibleRow, statusId: 3, hasVisibleChild: 1 };
		const reply = { ...visibleRow, id: 11, parentId: 10, statusId: 1 };
		const mysql = createMockMysql([tombstone], [{ total: 1 }], [reply]);
		const app = await buildApp(mysql);

		const response = await app.inject({ method: 'GET', url: '/comments?thingId=5' });
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.items).toHaveLength(1);
		expect(body.items[0].text).toBeNull();
		expect(body.items[0].authorDisplayName).toBe('—');
		expect(body.items[0].isAuthor).toBe(false);
		expect(body.items[0].replies).toHaveLength(1);
		expect(body.items[0].replies[0].text).toBe('Hello world');
	});
});

describe('GET /comments/:commentId', () => {
	const sectionCtx = [{ sectionIdentifier: 'spring-cycle', positionInSection: 7 }];

	it('bundles replies for a top-level comment with section context for the deep link', async () => {
		const top = { ...visibleRow, parentId: null, hasVisibleChild: 1 };
		const reply = { ...visibleRow, id: 11, parentId: 10, hasVisibleChild: 0 };
		// Query order: commentByIdQuery → thingSectionContextQuery → repliesByParentIdQuery
		const mysql = createMockMysql([top], sectionCtx, [reply]);
		const app = await buildApp(mysql);

		const response = await app.inject({ method: 'GET', url: '/comments/10' });
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.id).toBe(10);
		expect(body.replies).toHaveLength(1);
		expect(body.replies[0].id).toBe(11);
		expect(body.sectionIdentifier).toBe('spring-cycle');
		expect(body.positionInSection).toBe(7);
	});

	it('returns a reply with section context (same thing, same deep-link target)', async () => {
		const reply = { ...visibleRow, id: 11, parentId: 10, hasVisibleChild: 0 };
		// Query order: commentByIdQuery → thingSectionContextQuery (no replies fetch)
		const mysql = createMockMysql([reply], sectionCtx);
		const app = await buildApp(mysql);

		const response = await app.inject({ method: 'GET', url: '/comments/11' });
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.id).toBe(11);
		expect(body.parentId).toBe(10);
		expect(body.replies).toBeUndefined();
		expect(body.sectionIdentifier).toBe('spring-cycle');
		expect(body.positionInSection).toBe(7);
	});

	it('returns null section context for a guestbook comment (thingId IS NULL)', async () => {
		const top = { ...visibleRow, thingId: null, parentId: null, hasVisibleChild: 0 };
		// thingId is null → thingSectionContextQuery is skipped → only repliesByParentIdQuery runs.
		const mysql = createMockMysql([top], []);
		const app = await buildApp(mysql);

		const response = await app.inject({ method: 'GET', url: '/comments/10' });
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.thingId).toBeNull();
		expect(body.sectionIdentifier).toBeNull();
		expect(body.positionInSection).toBeNull();
	});

	it('returns null section context when the thing is in zero sections', async () => {
		const top = { ...visibleRow, parentId: null, hasVisibleChild: 0 };
		// thingSectionContextQuery returns no rows (LIMIT 1 query found nothing).
		const mysql = createMockMysql([top], [], []);
		const app = await buildApp(mysql);

		const response = await app.inject({ method: 'GET', url: '/comments/10' });
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.sectionIdentifier).toBeNull();
		expect(body.positionInSection).toBeNull();
	});

	it('returns 404 for unknown id', async () => {
		const mysql = createMockMysql([]);
		const app = await buildApp(mysql);
		const response = await app.inject({ method: 'GET', url: '/comments/999' });
		expect(response.statusCode).toBe(404);
	});
});

describe('POST /comments', () => {
	it('returns 401 without auth', async () => {
		const app = await buildApp(createMockMysql());
		const response = await app.inject({
			method: 'POST',
			url: '/comments',
			payload: { thingId: 5, text: 'hello there' },
		});
		expect(response.statusCode).toBe(401);
	});

	it('returns 403 without canComment', async () => {
		const app = await buildApp(createMockMysql());
		const token = await buildToken({ canComment: false });
		const response = await app.inject({
			method: 'POST',
			url: '/comments',
			headers: { authorization: `Bearer ${token}` },
			payload: { thingId: 5, text: 'hello there' },
		});
		expect(response.statusCode).toBe(403);
	});

	it('rejects empty text', async () => {
		const app = await buildApp(createMockMysql());
		const token = await buildToken();
		const response = await app.inject({
			method: 'POST',
			url: '/comments',
			headers: { authorization: `Bearer ${token}` },
			payload: { thingId: 5, text: '' },
		});
		expect(response.statusCode).toBe(400);
	});

	it('rejects flooded text', async () => {
		const app = await buildApp(createMockMysql());
		const token = await buildToken();
		const flood = 'a'.repeat(60);
		const response = await app.inject({
			method: 'POST',
			url: '/comments',
			headers: { authorization: `Bearer ${token}` },
			payload: { thingId: 5, text: flood },
		});
		expect(response.statusCode).toBe(400);
		expect(response.json().error).toBe('TEXT_FLOOD');
	});

	it('writes an in-app reply notification when the parent author is not the replier', async () => {
		const parentMeta = {
			id: 50,
			parentId: null,
			thingId: 7,
			userId: 2,
			statusId: 1,
			createdAt: new Date(),
		};
		const replyContextRow = {
			thingId: 7,
			sectionIdentifier: 'sec',
			positionInSection: 3,
			authorUserId: 2,
			authorLogin: 'parentauthor',
			authorEmail: 'parent@example.com',
			authorUserRights: 0,
			authorGroupRights: 0,
			authorNotifyOnReply: 1,
		};

		// Reply path query order:
		// 1) getCommentMeta(parentId)
		// 2) createComment (INSERT)
		// 3) getCommentById (returned to client)
		// 4) getCommentReplyContext
		// 5) insertReplyNotification (INSERT INTO notification) — fire-and-forget
		const mysql = createMockMysql(
			[parentMeta],
			{ insertId: 999, affectedRows: 1 },
			[{ ...visibleRow, id: 999, parentId: 50, userId: 1 }],
			[replyContextRow],
			{ insertId: 123, affectedRows: 1 },
		);
		const app = await buildApp(mysql);
		const token = await buildToken();

		const response = await app.inject({
			method: 'POST',
			url: '/comments',
			headers: { authorization: `Bearer ${token}` },
			payload: { parentId: 50, text: 'A reply' },
		});

		expect(response.statusCode).toBe(201);
		// Allow the fire-and-forget notification promise to settle.
		await new Promise((r) => setImmediate(r));

		// Assert the notification INSERT was hit (cumulative SQL across all connections).
		const allSql = mysql.__sqlLog.join('\n');
		expect(allSql).toContain('INSERT INTO notification');
	});
});

describe('PUT /comments/:commentId/vote', () => {
	it('returns 401 without auth', async () => {
		const app = await buildApp(createMockMysql());
		const response = await app.inject({
			method: 'PUT',
			url: '/comments/10/vote',
			payload: { vote: 'like' },
		});
		expect(response.statusCode).toBe(401);
	});

	it('returns 403 without canVote', async () => {
		const app = await buildApp(createMockMysql());
		const token = await buildToken({ canVote: false });
		const response = await app.inject({
			method: 'PUT',
			url: '/comments/10/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: 'like' },
		});
		expect(response.statusCode).toBe(403);
	});

	it('returns 404 when comment does not exist', async () => {
		const mysql = createMockMysql([]);
		const app = await buildApp(mysql);
		const token = await buildToken();
		const response = await app.inject({
			method: 'PUT',
			url: '/comments/10/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: 'like' },
		});
		expect(response.statusCode).toBe(404);
	});

	it('returns 409 when comment is not visible', async () => {
		const mysql = createMockMysql([{ id: 10, userId: 2, thingId: 5, parentId: null, statusId: 3, createdAt: new Date() }]);
		const app = await buildApp(mysql);
		const token = await buildToken();
		const response = await app.inject({
			method: 'PUT',
			url: '/comments/10/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: 'like' },
		});
		expect(response.statusCode).toBe(409);
	});

	it('sends a vote notification email when voter is not the comment author', async () => {
		const { sendEmail } = await import('../../lib/email.js');
		vi.mocked(sendEmail).mockClear();

		// meta (authorId=2, not the voter sub=1), upsert, voteContext, voteCounts, userVote
		const mysql = createMockMysql(
			[{ id: 10, userId: 2, thingId: 5, parentId: null, statusId: 1, createdAt: new Date() }],
			[],
			[{
				authorUserId: 2,
				thingId: 5,
				parentId: null,
				commentText: 'some comment text',
				authorDisplayName: 'author',
				authorEmail: 'author@example.com',
				authorUserRights: 24,
				authorGroupRights: 0,
				authorNotifyOnVote: 1,
				sectionIdentifier: 'poems',
				positionInSection: 3,
			}],
			[{ likes: 1, dislikes: 0 }],
			[{ vote: 1 }],
		);
		const app = await buildApp(mysql);
		const token = await buildToken({ sub: 1 });

		const response = await app.inject({
			method: 'PUT',
			url: '/comments/10/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: 'like' },
		});

		expect(response.statusCode).toBe(200);
		// Allow the fire-and-forget promise to settle
		await new Promise((r) => setImmediate(r));
		expect(sendEmail).toHaveBeenCalledOnce();
	});

	it('writes an in-app vote notification (bucket insert) even when the email toggle is off', async () => {
		const { sendEmail } = await import('../../lib/email.js');
		vi.mocked(sendEmail).mockClear();

		// meta (authorId=2, not the voter sub=1), upsert, voteContext (toggle OFF),
		// findUnreadVoteBucket (miss → empty), insertNotification, voteCounts, userVote
		const mysql = createMockMysql(
			[{ id: 10, userId: 2, thingId: 5, parentId: null, statusId: 1, createdAt: new Date() }],
			[],
			[{
				authorUserId: 2,
				thingId: 5,
				parentId: null,
				commentText: 'text',
				authorDisplayName: 'author',
				authorLogin: 'author',
				authorEmail: 'author@example.com',
				authorUserRights: 0,
				authorGroupRights: 0,
				authorNotifyOnVote: 0,
				sectionIdentifier: 'sec',
				positionInSection: 3,
			}],
			[],
			{ insertId: 77, affectedRows: 1 },
			[{ likes: 1, dislikes: 0 }],
			[{ vote: 1 }],
		);
		const app = await buildApp(mysql);
		const token = await buildToken({ sub: 1 });

		const response = await app.inject({
			method: 'PUT',
			url: '/comments/10/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: 'like' },
		});

		expect(response.statusCode).toBe(200);
		// Allow the fire-and-forget notification promise to settle.
		await new Promise((r) => setImmediate(r));

		// Email toggle is off → no email sent.
		expect(sendEmail).not.toHaveBeenCalled();

		// But the notification insert HAS happened.
		const allSql = mysql.__sqlLog.join('\n');
		expect(allSql).toContain('INSERT INTO notification');
	});

	it('does not send a notification email on self-vote', async () => {
		const { sendEmail } = await import('../../lib/email.js');
		vi.mocked(sendEmail).mockClear();

		// meta (authorId=1, same as voter sub=1), upsert, voteCounts, userVote
		const mysql = createMockMysql(
			[{ id: 10, userId: 1, thingId: 5, parentId: null, statusId: 1, createdAt: new Date() }],
			[],
			[{ likes: 1, dislikes: 0 }],
			[{ vote: 1 }],
		);
		const app = await buildApp(mysql);
		const token = await buildToken({ sub: 1 });

		const response = await app.inject({
			method: 'PUT',
			url: '/comments/10/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: 'like' },
		});

		expect(response.statusCode).toBe(200);
		await new Promise((r) => setImmediate(r));
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('does not send a notification email on vote removal', async () => {
		const { sendEmail } = await import('../../lib/email.js');
		vi.mocked(sendEmail).mockClear();

		// meta (authorId=2), deleteVote, voteCounts, userVote
		const mysql = createMockMysql(
			[{ id: 10, userId: 2, thingId: 5, parentId: null, statusId: 1, createdAt: new Date() }],
			[],
			[{ likes: 0, dislikes: 0 }],
			[],
		);
		const app = await buildApp(mysql);
		const token = await buildToken({ sub: 1 });

		const response = await app.inject({
			method: 'PUT',
			url: '/comments/10/vote',
			headers: { authorization: `Bearer ${token}` },
			payload: { vote: null },
		});

		expect(response.statusCode).toBe(200);
		await new Promise((r) => setImmediate(r));
		expect(sendEmail).not.toHaveBeenCalled();
	});
});

describe('POST /comments/:commentId/report', () => {
	it('returns 401 without auth', async () => {
		const app = await buildApp(createMockMysql());
		const response = await app.inject({
			method: 'POST',
			url: '/comments/10/report',
			payload: {},
		});
		expect(response.statusCode).toBe(401);
	});
});
