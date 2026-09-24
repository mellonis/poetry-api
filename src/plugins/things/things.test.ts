import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { thingsPlugin } from './things.js';

function createMockMysql(...responses: Record<string, unknown>[][]): MySQLPromisePool {
	let callIndex = 0;
	return {
		getConnection: vi.fn().mockImplementation(() =>
			Promise.resolve({
				query: vi.fn().mockImplementation(() => Promise.resolve([responses[callIndex++] ?? []])),
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
	await app.register(thingsPlugin, { prefix: '/things' });
	return app;
}

const row = (sectionId: string, position: number) => ({
	id: 42, categoryId: 1, title: 'Утро', firstLines: 'Строка первая\nСтрока вторая', startDate: null, finishDate: '2020-05-00',
	lastModified: null, text: '[p]Текст[/p]', seoDescription: null, seoKeywords: null, info: null, notes: '["примечание"]',
	votesLikes: 2, votesDislikes: 0, sectionId, position,
});

describe('GET /things/:thingId', () => {
	it('returns one thing with all its section placements', async () => {
		const app = await buildApp(createMockMysql([row('nnils', 7), row('ring', 3)]));
		const res = await app.inject({ method: 'GET', url: '/things/42' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body).toMatchObject({ id: 42, title: 'Утро', finishDate: '2020-05', text: '[p]Текст[/p]', notes: ['примечание'], votes: { likes: 2, dislikes: 0 } });
		expect(body.sections).toEqual([{ id: 'nnils', position: 7 }, { id: 'ring', position: 3 }]);
	});

	it('404s for an unknown or unpublished thing', async () => {
		const app = await buildApp(createMockMysql([]));
		const res = await app.inject({ method: 'GET', url: '/things/999' });
		expect(res.statusCode).toBe(404);
	});

	it('400s on a non-numeric id', async () => {
		const app = await buildApp(createMockMysql([]));
		const res = await app.inject({ method: 'GET', url: '/things/abc' });
		expect(res.statusCode).toBe(400);
	});
});
