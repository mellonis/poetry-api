import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { sectionsPlugin } from './sections.js';

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

function createFailingMysql(error = new Error('DB error')): MySQLPromisePool {
	return {
		getConnection: vi.fn().mockRejectedValue(error),
	} as unknown as MySQLPromisePool;
}

function buildApp(mysql: MySQLPromisePool) {
	const app = Fastify({ logger: false });

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.decorate('mysql', mysql);
	app.decorateRequest('user', null);
	app.decorate('optionalVerifyJwt', async () => {});
	app.register(sectionsPlugin, { prefix: '/sections' });

	return app;
}

const sectionRow = {
	id: 'poetry',
	typeId: 1,
	title: 'Poetry',
	description: null,
	annotationText: null,
	annotationAuthor: null,
	settings: JSON.stringify({ show_all: false, things_order: 1 }),
	thingsCount: 2,
};

const thingRow = {
	id: 1,
	position: 1,
	categoryId: 1,
	title: 'Poem',
	firstLines: 'First line\r\nSecond line',
	startDate: null,
	finishDate: '2024-01-01',
	text: 'Full poem text',
	seoDescription: null,
	seoKeywords: null,
	info: null,
	notes: null,
	votesLikes: 0,
	votesDislikes: 0,
};

function createQueryFailingMysql(firstQueryResult: Record<string, unknown>[], error = new Error('DB error')): MySQLPromisePool {
	return {
		getConnection: vi.fn()
			.mockResolvedValueOnce({
				query: vi.fn().mockResolvedValue([firstQueryResult]),
				release: vi.fn(),
			})
			.mockRejectedValueOnce(error),
	} as unknown as MySQLPromisePool;
}

describe('GET /sections', () => {
	it('returns 500 when DB throws', async () => {
		const app = buildApp(createFailingMysql());
		const response = await app.inject({ method: 'GET', url: '/sections' });

		expect(response.statusCode).toBe(500);
		expect(response.json()).toEqual({ error: 'Internal server error' });
	});

	it('returns sections list', async () => {
		const app = buildApp(createMockMysql([sectionRow]));
		const response = await app.inject({ method: 'GET', url: '/sections' });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([{
			id: 'poetry',
			typeId: 1,
			title: 'Poetry',
			settings: { showAll: false, thingsOrder: 1 },
			thingsCount: 2,
		}]);
	});

	it('returns empty array when no sections exist', async () => {
		const app = buildApp(createMockMysql([]));
		const response = await app.inject({ method: 'GET', url: '/sections' });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([]);
	});

	it('maps showAll: true correctly', async () => {
		const app = buildApp(createMockMysql([{ ...sectionRow, settings: JSON.stringify({ show_all: true, things_order: 1 }) }]));
		const response = await app.inject({ method: 'GET', url: '/sections' });

		expect(response.json()[0].settings.showAll).toBe(true);
	});

	it('maps thingsOrder: -1 correctly', async () => {
		const app = buildApp(createMockMysql([{ ...sectionRow, settings: JSON.stringify({ show_all: false, things_order: -1 }) }]));
		const response = await app.inject({ method: 'GET', url: '/sections' });

		expect(response.json()[0].settings.thingsOrder).toBe(-1);
	});

	it('includes description when present', async () => {
		const app = buildApp(createMockMysql([{ ...sectionRow, description: 'A poetry collection' }]));
		const response = await app.inject({ method: 'GET', url: '/sections' });

		expect(response.json()[0].description).toBe('A poetry collection');
	});

	it('omits annotation when annotationText is null', async () => {
		const app = buildApp(createMockMysql([sectionRow]));
		const response = await app.inject({ method: 'GET', url: '/sections' });

		expect(response.json()[0].annotation).toBeUndefined();
	});

	it('includes annotation with text and author', async () => {
		const app = buildApp(createMockMysql([{
			...sectionRow,
			annotationText: 'Some epigraph text',
			annotationAuthor: 'Some Author',
		}]));
		const response = await app.inject({ method: 'GET', url: '/sections' });

		expect(response.json()[0].annotation).toEqual({
			text: 'Some epigraph text',
			author: 'Some Author',
		});
	});

	it('includes annotation with text only when author is null', async () => {
		const app = buildApp(createMockMysql([{
			...sectionRow,
			annotationText: 'Some epigraph text',
			annotationAuthor: null,
		}]));
		const response = await app.inject({ method: 'GET', url: '/sections' });

		expect(response.json()[0].annotation).toEqual({
			text: 'Some epigraph text',
		});
	});
});

describe('GET /sections/:identifier', () => {
	it('returns 404 when section not found', async () => {
		const app = buildApp(createMockMysql([]));
		const response = await app.inject({ method: 'GET', url: '/sections/unknown' });

		expect(response.statusCode).toBe(404);
	});

	it('returns empty array when section has no things', async () => {
		const app = buildApp(createMockMysql([sectionRow], []));
		const response = await app.inject({ method: 'GET', url: '/sections/poetry' });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([]);
	});

	it('returns things with split firstLines and no notes', async () => {
		const app = buildApp(createMockMysql([sectionRow], [thingRow]));
		const response = await app.inject({ method: 'GET', url: '/sections/poetry' });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([{
			id: 1,
			position: 1,
			categoryId: 1,
			title: 'Poem',
			firstLines: ['First line', 'Second line'],
			finishDate: '2024-01-01',
			text: 'Full poem text',
			votes: { likes: 0, dislikes: 0 },
		}]);
	});

	it('attaches notes to things', async () => {
		const thingWithNotes = { ...thingRow, notes: JSON.stringify(['Note one', 'Note two']) };
		const app = buildApp(createMockMysql([sectionRow], [thingWithNotes]));
		const response = await app.inject({ method: 'GET', url: '/sections/poetry' });

		expect(response.statusCode).toBe(200);
		expect(response.json()[0].notes).toEqual(['Note one', 'Note two']);
	});

	it('returns 500 when getSectionById throws', async () => {
		const app = buildApp(createFailingMysql());
		const response = await app.inject({ method: 'GET', url: '/sections/poetry' });

		expect(response.statusCode).toBe(500);
		expect(response.json()).toEqual({ error: 'Internal server error' });
	});

	it('returns 500 when getSectionThings throws', async () => {
		const app = buildApp(createQueryFailingMysql([sectionRow]));
		const response = await app.inject({ method: 'GET', url: '/sections/poetry' });

		expect(response.statusCode).toBe(500);
		expect(response.json()).toEqual({ error: 'Internal server error' });
	});

	it('distributes notes to the correct things', async () => {
		const firstThingRow = { ...thingRow, notes: JSON.stringify(['Note for first']) };
		const secondThingRow = { ...thingRow, id: 2, position: 2, title: 'Poem 2', notes: JSON.stringify(['Note for second']) };
		const app = buildApp(createMockMysql([sectionRow], [firstThingRow, secondThingRow]));
		const response = await app.inject({ method: 'GET', url: '/sections/poetry' });

		const body = response.json();

		expect(body[0].notes).toEqual(['Note for first']);
		expect(body[1].notes).toEqual(['Note for second']);
	});
});
