import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { authPlugin } from '../auth/auth.js';
import { cmsPlugin } from './cms.js';
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
				query: vi.fn().mockImplementation(() => Promise.resolve([responses[callIndex++] ?? []])),
				beginTransaction: vi.fn().mockResolvedValue(undefined),
				commit: vi.fn().mockResolvedValue(undefined),
				rollback: vi.fn().mockResolvedValue(undefined),
				release: vi.fn(),
			})
		),
	} as unknown as MySQLPromisePool;
}

const mockNotifier = {
	sendActivation: vi.fn().mockResolvedValue(undefined),
	sendPasswordReset: vi.fn().mockResolvedValue(undefined),
	sendPasswordChanged: vi.fn().mockResolvedValue(undefined),
	sendAdminActivation: vi.fn().mockResolvedValue(undefined),
	sendAdminPasswordReset: vi.fn().mockResolvedValue(undefined),
	sendAdminResendActivation: vi.fn().mockResolvedValue(undefined),
};

async function buildApp(mysql: MySQLPromisePool) {
	const app = Fastify({ logger: false });

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.decorate('mysql', mysql);
	app.decorate('authNotifier', mockNotifier);
	app.decorate('resolveOrigin', () => 'https://test.example.com');
	app.register(authPlugin);
	app.register(cmsPlugin, { prefix: '/cms' });

	return app;
}

const getEditorToken = async (canEditContent = true) =>
	signAccessToken({
		sub: 1,
		login: 'editor',
		isAdmin: false,
		isEditor: true,
		tokenVersion: 0,
		rights: { canVote: true, canComment: true, canEditContent, canEditUsers: false },
	}, secret);

const getNonEditorToken = async () =>
	signAccessToken({
		sub: 2,
		login: 'user',
		isAdmin: false,
		isEditor: false,
		tokenVersion: 0,
		rights: { canVote: true, canComment: true, canEditContent: false, canEditUsers: false },
	}, secret);

const getAdminToken = async (canEditUsers = true) =>
	signAccessToken({
		sub: 100,
		login: 'admin',
		isAdmin: true,
		isEditor: true,
		tokenVersion: 0,
		rights: { canVote: true, canComment: true, canEditContent: true, canEditUsers },
	}, secret);

const sectionRow = {
	id: 10,
	identifier: 'nstran',
	title: 'Test Section',
	description: null,
	annotationText: null,
	annotationAuthor: null,
	typeId: 1,
	statusId: 2,
	redirectSectionId: null,
	settings: null,
	order: 1,
};

// --- Auth tests ---

describe('CMS auth', () => {
	it('returns 401 without auth token', async () => {
		const app = await buildApp(createMockMysql());

		const response = await app.inject({ method: 'GET', url: '/cms/sections' });

		expect(response.statusCode).toBe(401);
	});

	it('returns 403 for non-editor user', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getNonEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/sections',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json().message).toBe('Editor access required');
	});

	it('allows GET for editor without canEditContent right', async () => {
		const app = await buildApp(createMockMysql([sectionRow]));
		const token = await getEditorToken(false);

		const response = await app.inject({
			method: 'GET',
			url: '/cms/sections',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
	});

	it('returns 403 for mutation without canEditContent right', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getEditorToken(false);

		const response = await app.inject({
			method: 'POST',
			url: '/cms/sections',
			headers: { authorization: `Bearer ${token}` },
			payload: { identifier: 'test', title: 'Test', typeId: 1 },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json().message).toBe('Missing required right: canEditContent');
	});
});

// --- Section types ---

describe('GET /cms/section-types', () => {
	it('returns section types', async () => {
		const types = [{ id: 0, title: 'Deprecated' }, { id: 1, title: 'Normal' }];
		const app = await buildApp(createMockMysql(types));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/section-types',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual(types);
	});
});

// --- Sections CRUD ---

describe('GET /cms/sections', () => {
	it('returns non-deprecated sections', async () => {
		const app = await buildApp(createMockMysql([sectionRow]));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/sections',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		const sections = response.json();
		expect(sections).toHaveLength(1);
		expect(sections[0].id).toBe(10);
		expect(sections[0].settings).toBeNull();
	});

	it('maps settings correctly', async () => {
		const row = { ...sectionRow, settings: '{"show_all":true,"things_order":-1}' };
		const app = await buildApp(createMockMysql([row]));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/sections',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.json()[0].settings).toEqual({ showAll: true, reverseOrder: true });
	});

	it('maps default settings to reverseOrder false', async () => {
		const row = { ...sectionRow, settings: '{"show_all":false,"things_order":1}' };
		const app = await buildApp(createMockMysql([row]));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/sections',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.json()[0].settings).toEqual({ showAll: false, reverseOrder: false });
	});
});

describe('POST /cms/sections', () => {
	it('creates a section', async () => {
		// Responses: maxOrder query, insert query, getCmsSectionById query
		const createdRow = { ...sectionRow, id: 99 };
		const app = await buildApp(createMockMysql(
			[{ maxOrder: 5 }],
			[{ insertId: 99 }],
			[createdRow],
		));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/sections',
			headers: { authorization: `Bearer ${token}` },
			payload: { identifier: 'newsec', title: 'New Section', typeId: 1 },
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().id).toBe(99);
	});

	it('rejects invalid identifier', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/sections',
			headers: { authorization: `Bearer ${token}` },
			payload: { identifier: 'INVALID', title: 'Test', typeId: 1 },
		});

		expect(response.statusCode).toBe(400);
	});
});

describe('DELETE /cms/sections/:sectionId', () => {
	it('refuses deletion when section has incoming redirects', async () => {
		// Responses: getCmsSectionById, getExternalRedirectsToSection
		const app = await buildApp(createMockMysql(
			[sectionRow],
			[{ fromSectionId: 2, fromSectionIdentifier: 'stran', fromThingId: 5 }],
		));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'DELETE',
			url: '/cms/sections/10',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().error).toContain('incoming redirects');
	});

	it('returns 404 for non-existent section', async () => {
		const app = await buildApp(createMockMysql([]));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'DELETE',
			url: '/cms/sections/999',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(404);
	});
});

// --- Things in section ---

describe('GET /cms/sections/:sectionId/things', () => {
	it('returns things in section', async () => {
		const thingRow = { thingId: 1, position: 1, title: 'Poem', firstLines: 'Line 1\nLine 2' };
		// Responses: getCmsSectionById, getCmsThingsInSection
		const app = await buildApp(createMockMysql([sectionRow], [thingRow]));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/sections/10/things',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		const things = response.json();
		expect(things).toHaveLength(1);
		expect(things[0].firstLines).toEqual(['Line 1', 'Line 2']);
	});
});

describe('POST /cms/sections/:sectionId/things', () => {
	it('returns 404 when thing does not exist', async () => {
		// Responses: getCmsSectionById, thingExists (empty = not found)
		const app = await buildApp(createMockMysql([sectionRow], []));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/sections/10/things',
			headers: { authorization: `Bearer ${token}` },
			payload: { thingId: 999 },
		});

		expect(response.statusCode).toBe(404);
		expect(response.json().error).toBe('Thing not found');
	});
});

describe('PUT /cms/sections/:sectionId/things/reorder', () => {
	it('rejects mismatched thing IDs', async () => {
		// Responses: getCmsSectionById, getSectionThingIds
		const app = await buildApp(createMockMysql(
			[sectionRow],
			[{ thingId: 1 }, { thingId: 2 }],
		));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'PUT',
			url: '/cms/sections/10/things/reorder',
			headers: { authorization: `Bearer ${token}` },
			payload: [1, 3],
		});

		expect(response.statusCode).toBe(400);
		expect(response.json().error).toContain('must match');
	});
});

// --- CMS thing date format ---

const thingRow = {
	id: 42,
	title: 'Test',
	text: 'Body',
	categoryId: 1,
	statusId: 2,
	startDate: null,
	finishDate: '1990-05-12',
	firstLines: null,
	firstLinesAutoGenerating: 0,
	excludeFromDaily: 0,
	seoDescription: null,
	seoKeywords: null,
	info: null,
};

describe('GET /cms/things/:thingId — date format', () => {
	it('returns full date as YYYY-MM-DD', async () => {
		const app = await buildApp(createMockMysql([thingRow], []));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/things/42',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().finishDate).toBe('1990-05-12');
	});

	it('trims YYYY-MM-00 to YYYY-MM', async () => {
		const app = await buildApp(createMockMysql([{ ...thingRow, finishDate: '1990-05-00' }], []));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/things/42',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.json().finishDate).toBe('1990-05');
	});

	it('trims YYYY-00-00 to YYYY', async () => {
		const app = await buildApp(createMockMysql([{ ...thingRow, finishDate: '1990-00-00' }], []));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/things/42',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.json().finishDate).toBe('1990');
	});

	it('returns startDate trimmed too', async () => {
		const app = await buildApp(createMockMysql([{ ...thingRow, startDate: '1989-00-00', finishDate: '1990-05-00' }], []));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/things/42',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.json().startDate).toBe('1989');
		expect(response.json().finishDate).toBe('1990-05');
	});
});

describe('POST /cms/things — date format', () => {
	const basePayload = {
		title: null,
		text: 'Body',
		categoryId: 1,
		notes: [],
	};

	it('accepts ISO year-only and pads to YYYY-00-00 on write', async () => {
		const app = await buildApp(createMockMysql(
			[{ insertId: 99 }],
			[thingRow],
			[],
		));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/things',
			headers: { authorization: `Bearer ${token}` },
			payload: { ...basePayload, finishDate: '1990' },
		});

		expect(response.statusCode).toBe(201);
	});

	it('accepts ISO year-month', async () => {
		const app = await buildApp(createMockMysql([{ insertId: 99 }], [thingRow], []));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/things',
			headers: { authorization: `Bearer ${token}` },
			payload: { ...basePayload, finishDate: '1990-05' },
		});

		expect(response.statusCode).toBe(201);
	});

	it('accepts ISO full date', async () => {
		const app = await buildApp(createMockMysql([{ insertId: 99 }], [thingRow], []));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/things',
			headers: { authorization: `Bearer ${token}` },
			payload: { ...basePayload, finishDate: '1990-05-12' },
		});

		expect(response.statusCode).toBe(201);
	});

	it('rejects legacy YYYY-MM-00 form', async () => {
		const app = await buildApp(createMockMysql([{ insertId: 99 }], []));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/things',
			headers: { authorization: `Bearer ${token}` },
			payload: { ...basePayload, finishDate: '1990-05-00' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('rejects invalid month', async () => {
		const app = await buildApp(createMockMysql([{ insertId: 99 }], []));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/things',
			headers: { authorization: `Bearer ${token}` },
			payload: { ...basePayload, finishDate: '1990-13' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('rejects day-in-month mismatch', async () => {
		const app = await buildApp(createMockMysql([{ insertId: 99 }], []));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/things',
			headers: { authorization: `Bearer ${token}` },
			payload: { ...basePayload, finishDate: '1990-02-31' },
		});

		expect(response.statusCode).toBe(400);
	});
});

// --- User management ---

const userRow = {
	id: 5,
	login: 'testuser',
	email: 'test@example.com',
	groupId: 3,
	groupTitle: 'users',
	rights: 24,
	lastLogin: null,
};

const groupRows = [
	{ id: 0, title: 'guests', rights: 0 },
	{ id: 1, title: 'admins', rights: 63488 },
	{ id: 2, title: 'editors', rights: 14336 },
	{ id: 3, title: 'users', rights: 0 },
];

describe('CMS user management auth', () => {
	it('returns 403 for editor (not admin) on /cms/users', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/users',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json().message).toBe('Admin access required');
	});

	it('returns 403 for admin without canEditUsers on /cms/users', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getAdminToken(false);

		const response = await app.inject({
			method: 'GET',
			url: '/cms/users',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json().message).toBe('Missing required right: canEditUsers');
	});

	it('allows admin with canEditUsers to list users', async () => {
		const app = await buildApp(createMockMysql([userRow]));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/users',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toHaveLength(1);
		expect(response.json()[0].login).toBe('testuser');
	});
});

describe('GET /cms/users/:userId', () => {
	it('returns 404 for non-existent user', async () => {
		const app = await buildApp(createMockMysql([]));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/users/999',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(404);
	});

	it('returns user by id', async () => {
		const app = await buildApp(createMockMysql([userRow]));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/users/5',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().id).toBe(5);
		expect(response.json().isBanned).toBe(false);
		expect(response.json().isEmailActivated).toBe(false);
	});
});

describe('POST /cms/users', () => {
	it('returns 409 for duplicate login or email', async () => {
		// Responses: loginOrEmailExists returns a row
		const app = await buildApp(createMockMysql([{ '1': 1 }]));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/users',
			headers: { authorization: `Bearer ${token}` },
			payload: { login: 'testuser', email: 'test@example.com', password: 'pass123', groupId: 3 },
		});

		expect(response.statusCode).toBe(409);
	});

	it('creates a user', async () => {
		// Responses: loginOrEmailExists (empty), insertCmsUser, getUserById
		const app = await buildApp(createMockMysql(
			[],
			[{ insertId: 50 }],
			[{ ...userRow, id: 50 }],
		));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/users',
			headers: { authorization: `Bearer ${token}` },
			payload: { login: 'newuser', email: 'new@example.com', password: 'pass123', groupId: 3 },
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().id).toBe(50);
		expect(mockNotifier.sendAdminActivation).toHaveBeenCalled();
	});

	it('rejects invalid login format', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/users',
			headers: { authorization: `Bearer ${token}` },
			payload: { login: 'INVALID!', email: 'test@example.com', password: 'pass123', groupId: 3 },
		});

		expect(response.statusCode).toBe(400);
	});
});

describe('PUT /cms/users/:userId', () => {
	it('prevents self group change', async () => {
		// Admin token has sub=100. Editing user 100.
		// Responses: getUserById
		const selfRow = { ...userRow, id: 100, login: 'admin', groupId: 1, groupTitle: 'admins' };
		const app = await buildApp(createMockMysql([selfRow]));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'PUT',
			url: '/cms/users/100',
			headers: { authorization: `Bearer ${token}` },
			payload: { groupId: 3 },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().error).toBe('Cannot change own group');
	});

	it('prevents self ban', async () => {
		const selfRow = { ...userRow, id: 100, login: 'admin', groupId: 1, groupTitle: 'admins' };
		// Responses: getUserById, getGroups (for canEditUsers resolution)
		const app = await buildApp(createMockMysql([selfRow], groupRows));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'PUT',
			url: '/cms/users/100',
			headers: { authorization: `Bearer ${token}` },
			payload: { rights: 24 | 4 }, // add banned bit
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().error).toBe('Cannot ban self');
	});

	it('updates another user', async () => {
		// Responses: getUserById, getGroups, updateCmsUser, bumpTokenVersion, deleteRefreshTokens, getUserById (refetch)
		const updatedRow = { ...userRow, groupId: 2, groupTitle: 'editors' };
		const app = await buildApp(createMockMysql(
			[userRow],
			groupRows,
			[], // update
			[], // bump token
			[], // delete tokens
			[updatedRow],
		));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'PUT',
			url: '/cms/users/5',
			headers: { authorization: `Bearer ${token}` },
			payload: { groupId: 2 },
		});

		expect(response.statusCode).toBe(200);
	});
});

describe('DELETE /cms/users/:userId', () => {
	it('prevents self deletion', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'DELETE',
			url: '/cms/users/100',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json().message).toBe('Cannot delete self');
	});

	it('returns 404 for non-existent user', async () => {
		const app = await buildApp(createMockMysql([]));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'DELETE',
			url: '/cms/users/999',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(404);
	});

	it('deletes a user', async () => {
		// Responses: getUserById, deleteCmsUser
		const app = await buildApp(createMockMysql([userRow], []));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'DELETE',
			url: '/cms/users/5',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(204);
	});
});

describe('POST /cms/users/:userId/resend-activation', () => {
	it('rejects for already activated user', async () => {
		const activatedRow = { ...userRow, rights: 25 }; // bit 0 set = activated
		const app = await buildApp(createMockMysql([activatedRow]));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/users/5/resend-activation',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().error).toBe('User is already activated');
	});

	it('resends activation email', async () => {
		// Responses: getUserById, updateUserRightsAndKey
		const app = await buildApp(createMockMysql([userRow], []));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/users/5/resend-activation',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		expect(mockNotifier.sendAdminResendActivation).toHaveBeenCalled();
	});
});

describe('POST /cms/users/:userId/reset-password', () => {
	it('triggers password reset', async () => {
		// Responses: getUserById, updateUserRightsAndKey
		const app = await buildApp(createMockMysql([userRow], []));
		const token = await getAdminToken();

		const response = await app.inject({
			method: 'POST',
			url: '/cms/users/5/reset-password',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().message).toBe('Password reset email sent');
		expect(mockNotifier.sendAdminPasswordReset).toHaveBeenCalled();
	});
});

describe('reserved display names', () => {
	it('GET /cms/reserved-display-names returns list', async () => {
		const mysql = createMockMysql(
			[{ id: 1, value: 'admin', reason: null, createdAt: '2026-01-01T00:00:00.000Z', createdByUserId: null }],
			[{ total: 1 }],
		);
		const app = await buildApp(mysql);
		const token = await getEditorToken();
		const res = await app.inject({
			method: 'GET',
			url: '/cms/reserved-display-names',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.items).toHaveLength(1);
		expect(body.items[0].value).toBe('admin');
	});

	it('POST /cms/reserved-display-names creates entry', async () => {
		const mysql = createMockMysql(
			[],
			[{ insertId: 5 }],
		);
		const app = await buildApp(mysql);
		const token = await getAdminToken();
		const res = await app.inject({
			method: 'POST',
			url: '/cms/reserved-display-names',
			headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
			body: JSON.stringify({ value: 'superuser', reason: 'obvious' }),
		});
		expect(res.statusCode).toBe(201);
		expect(JSON.parse(res.body)).toMatchObject({ id: 5, value: 'superuser' });
	});

	it('POST /cms/reserved-display-names returns 409 for canonical duplicate', async () => {
		const mysql = createMockMysql(
			[{ value: 'admin' }],
		);
		const app = await buildApp(mysql);
		const token = await getAdminToken();
		const res = await app.inject({
			method: 'POST',
			url: '/cms/reserved-display-names',
			headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
			body: JSON.stringify({ value: 'аdmin' }), // Cyrillic 'а' — homoglyph of Latin 'a'
		});
		expect(res.statusCode).toBe(409);
	});

	it('DELETE /cms/reserved-display-names/:id removes entry', async () => {
		const mysql = createMockMysql([{ affectedRows: 1 }]);
		const app = await buildApp(mysql);
		const token = await getAdminToken();
		const res = await app.inject({
			method: 'DELETE',
			url: '/cms/reserved-display-names/1',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(res.statusCode).toBe(204);
	});

	it('returns 403 when canEditUsers is missing', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getEditorToken();
		const res = await app.inject({
			method: 'POST',
			url: '/cms/reserved-display-names',
			headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
			body: JSON.stringify({ value: 'x' }),
		});
		expect(res.statusCode).toBe(403);
	});
});

// --- Things-of-the-day calendar ---

describe('GET /cms/things-of-the-day/calendar', () => {
	it('returns 401 without auth token', async () => {
		const app = await buildApp(createMockMysql());

		const response = await app.inject({ method: 'GET', url: '/cms/things-of-the-day/calendar' });

		expect(response.statusCode).toBe(401);
	});

	it('returns 403 for non-editor user', async () => {
		const app = await buildApp(createMockMysql());
		const token = await getNonEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/things-of-the-day/calendar',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(403);
	});

	it('groups rows by bucketDate, emits both kinds, and folds multi-section rows', async () => {
		const mysql = createMockMysql([
			// Same thing in two sections — should fold to one entry with sections=[2]
			{
				kind: 'curated', bucketDate: '2026-05-06', id: 100, title: 'Today thing',
				firstLines: null, finishDate: '2010-05-06', statusId: 2, categoryId: 1,
				sectionId: 'love-poems', position: 5,
			},
			{
				kind: 'curated', bucketDate: '2026-05-06', id: 100, title: 'Today thing',
				firstLines: null, finishDate: '2010-05-06', statusId: 2, categoryId: 1,
				sectionId: 'winter-2010', position: 12,
			},
			// Untitled thing on the same day, single section. statusId: 3 (Editing)
			// — still surfaces under the #134 filter alignment (only Published+Editing).
			{
				kind: 'curated', bucketDate: '2026-05-06', id: 101, title: null,
				firstLines: 'Untitled today', finishDate: '2015-05-06', statusId: 3, categoryId: 1,
				sectionId: 'love-poems', position: 6,
			},
			// Fallback on next day, no section placements (sectionId = null)
			{
				kind: 'fallback', bucketDate: '2026-05-07', id: 200, title: null,
				firstLines: 'Random fill', finishDate: '2010-09-25', statusId: 2, categoryId: 1,
				sectionId: null, position: null,
			},
			// Month-only date round-trip
			{
				kind: 'curated', bucketDate: '2026-05-31', id: 102, title: 'Month-only thing',
				firstLines: null, finishDate: '2003-05-00', statusId: 2, categoryId: 1,
				sectionId: 'misc', position: 1,
			},
			// Fallback for an undated thing
			{
				kind: 'fallback', bucketDate: '2026-06-01', id: 300, title: null,
				firstLines: null, finishDate: '0000-00-00', statusId: 2, categoryId: 1,
				sectionId: 'misc', position: 99,
			},
		]);
		const app = await buildApp(mysql);
		const token = await getEditorToken(false); // GET works without canEditContent

		const response = await app.inject({
			method: 'GET',
			url: '/cms/things-of-the-day/calendar',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();

		expect(Object.keys(body)).toEqual(['2026-05-06', '2026-05-07', '2026-05-31', '2026-06-01']);

		// Two entries on May 6 — multi-section thing folded to one entry.
		expect(body['2026-05-06']).toHaveLength(2);
		expect(body['2026-05-06'][0]).toEqual({
			kind: 'curated', id: 100, title: 'Today thing',
			firstLines: null, finishDate: '2010-05-06', statusId: 2, categoryId: 1,
			sections: [
				{ id: 'love-poems', position: 5 },
				{ id: 'winter-2010', position: 12 },
			],
		});
		expect(body['2026-05-06'][1].sections).toEqual([{ id: 'love-poems', position: 6 }]);

		// Both curated and fallback kinds present somewhere in the response.
		const kinds = Object.values(body).flat().map((e: { kind: string }) => e.kind);
		expect(kinds).toContain('curated');
		expect(kinds).toContain('fallback');

		// Fallback with no placements → empty sections array, not omitted.
		expect(body['2026-05-07'][0].sections).toEqual([]);

		// Partial-date round-trip via dbDateToIso.
		expect(body['2026-05-31'][0].finishDate).toBe('2003-05');
		// Undated fallback surfaces as '0000'.
		expect(body['2026-06-01'][0].finishDate).toBe('0000');
	});

	it('returns an empty object when the query returns no rows', async () => {
		const app = await buildApp(createMockMysql([]));
		const token = await getEditorToken();

		const response = await app.inject({
			method: 'GET',
			url: '/cms/things-of-the-day/calendar',
			headers: { authorization: `Bearer ${token}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({});
	});
});
