import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Meilisearch } from 'meilisearch';
import { reindexAll } from './searchSync.js';

declare module 'fastify' {
	interface FastifyInstance {
		meiliClient: Meilisearch | null;
	}
}

const INDEX_NAME = 'things';
const INDEX_VERSION = 5;

export { INDEX_NAME as SEARCH_INDEX_NAME };

export default fp(async (fastify: FastifyInstance) => {
	const masterKey = process.env.MEILI_MASTER_KEY;

	if (!masterKey) {
		fastify.log.warn('MEILI_MASTER_KEY not set — search is disabled');
		fastify.decorate('meiliClient', null);
		return;
	}

	const url = process.env.MEILI_URL ?? 'http://poetry-meilisearch:7700';
	const client = new Meilisearch({ host: url, apiKey: masterKey });

	await client.createIndex(INDEX_NAME, { primaryKey: 'id' }).catch(() => {});

	const index = client.index(INDEX_NAME);
	await index.updateSettings({
		searchableAttributes: ['title', 'text', 'notes', 'audioTitles'],
		filterableAttributes: ['categoryId', 'statusId'],
		typoTolerance: {
			minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
		},
		rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
	});

	fastify.decorate('meiliClient', client);
	fastify.log.info({ url }, 'Meilisearch connected');

	await client.createIndex('_meta', { primaryKey: 'key' }).catch(() => {});
	const metaIndex = client.index('_meta');
	const currentVersion = await metaIndex.getDocument('index_version').then((d) => (d as { version?: number }).version).catch(() => null);

	if (currentVersion !== INDEX_VERSION) {
		fastify.log.info({ currentVersion, targetVersion: INDEX_VERSION }, 'Search index version changed — reindexing');
		reindexAll(client, fastify.mysql, fastify.log)
			.then(async (count) => {
				await metaIndex.addDocuments([{ key: 'index_version', version: INDEX_VERSION }]);
				fastify.log.info({ count, version: INDEX_VERSION }, 'Reindex complete');
			})
			.catch((err) => fastify.log.error(err, 'Reindex failed'));
	}
}, { name: 'search' });
