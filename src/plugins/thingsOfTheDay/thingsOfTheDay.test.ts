import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { thingsOfTheDayPlugin } from './thingsOfTheDay.js';

function createMockMysql(dateResults: Record<string, unknown>[], fallbackResults: Record<string, unknown>[] = []) {
	return {
		getConnection: vi.fn().mockResolvedValue({
			query: vi.fn()
				.mockResolvedValueOnce([dateResults])
				.mockResolvedValueOnce([fallbackResults]),
			release: vi.fn(),
		}),
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
	app.register(thingsOfTheDayPlugin, { prefix: '/things-of-the-day' });

	return app;
}

const thingRow = {
	id: 1,
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
	sectionId: 'poetry',
	position: 3,
};

describe('GET /things-of-the-day', () => {
	it('returns things matching today\'s date', async () => {
		const app = buildApp(createMockMysql([thingRow]));
		const response = await app.inject({ method: 'GET', url: '/things-of-the-day' });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([{
			id: 1,
			categoryId: 1,
			title: 'Poem',
			firstLines: ['First line', 'Second line'],
			finishDate: '2024-01-01',
			text: 'Full poem text',
			votes: { likes: 0, dislikes: 0 },
			sections: [{ id: 'poetry', position: 3 }],
		}]);
	});

	it('omits firstLines when null', async () => {
		const app = buildApp(createMockMysql([{ ...thingRow, firstLines: null }]));
		const response = await app.inject({ method: 'GET', url: '/things-of-the-day' });

		expect(response.json()[0].firstLines).toBeUndefined();
	});

	it('returns things with unknown day (YYYY-MM-00)', async () => {
		const app = buildApp(createMockMysql([{ ...thingRow, finishDate: '2024-01-00' }]));
		const response = await app.inject({ method: 'GET', url: '/things-of-the-day' });

		expect(response.statusCode).toBe(200);
		expect(response.json()[0].finishDate).toBe('2024-01-00');
	});

	it('uses fallback when no things match today\'s date', async () => {
		const app = buildApp(createMockMysql([], [thingRow]));
		const response = await app.inject({ method: 'GET', url: '/things-of-the-day' });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toHaveLength(1);
		expect(response.json()[0].id).toBe(1);
	});

	it('returns empty array when fallback also has no things', async () => {
		const app = buildApp(createMockMysql([], []));
		const response = await app.inject({ method: 'GET', url: '/things-of-the-day' });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([]);
	});

	it('collects all sections for a thing that appears in multiple sections', async () => {
		const secondSectionRow = { ...thingRow, sectionId: 'prose', position: 1 };
		const app = buildApp(createMockMysql([thingRow, secondSectionRow]));
		const response = await app.inject({ method: 'GET', url: '/things-of-the-day' });

		const body = response.json();

		expect(body).toHaveLength(1);
		expect(body[0].sections).toEqual([
			{ id: 'poetry', position: 3 },
			{ id: 'prose', position: 1 },
		]);
	});

	it('returns 500 when DB throws', async () => {
		const app = buildApp(createFailingMysql());
		const response = await app.inject({ method: 'GET', url: '/things-of-the-day' });

		expect(response.statusCode).toBe(500);
		expect(response.json()).toEqual({ error: 'Internal server error' });
	});

	it('returns things ordered newest to oldest by finishDate year', async () => {
		const olderRow = { ...thingRow, id: 2, finishDate: '2020-01-01', sectionId: 'prose', position: 1 };
		const app = buildApp(createMockMysql([thingRow, olderRow]));
		const response = await app.inject({ method: 'GET', url: '/things-of-the-day' });

		const body = response.json();

		expect(body).toHaveLength(2);
		expect(body[0].id).toBe(1);
		expect(body[1].id).toBe(2);
	});

	it('includes notes when present', async () => {
		const thingWithNotes = { ...thingRow, notes: JSON.stringify(['Note one', 'Note two']) };
		const app = buildApp(createMockMysql([thingWithNotes]));
		const response = await app.inject({ method: 'GET', url: '/things-of-the-day' });

		expect(response.json()[0].notes).toEqual(['Note one', 'Note two']);
	});

	it('returns multiple things with correct section assignments', async () => {
		const secondThingRow = { ...thingRow, id: 2, sectionId: 'prose', position: 5 };
		const app = buildApp(createMockMysql([thingRow, secondThingRow]));
		const response = await app.inject({ method: 'GET', url: '/things-of-the-day' });

		const body = response.json();

		expect(body).toHaveLength(2);
		expect(body[0].sections).toEqual([{ id: 'poetry', position: 3 }]);
		expect(body[1].sections).toEqual([{ id: 'prose', position: 5 }]);
	});
});
