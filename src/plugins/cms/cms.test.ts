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
