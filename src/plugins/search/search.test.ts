import { vi, beforeEach, afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';

const { mockMeilisearchCtor } = vi.hoisted(() => ({
	mockMeilisearchCtor: vi.fn(),
}));

vi.mock('meilisearch', () => ({
	Meilisearch: mockMeilisearchCtor,
}));

vi.mock('./searchSync.js', () => ({
	reindexAll: vi.fn().mockResolvedValue(0),
}));

// Static import is safe: vi.mock above is hoisted, so the plugin module
// resolves `Meilisearch` to the spy at parse time.
import searchPlugin from './search.js';

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('search plugin', () => {
	it('boots with meiliClient = null when meilisearch is unreachable', async () => {
		vi.stubEnv('MEILI_MASTER_KEY', 'test-key');
		mockMeilisearchCtor.mockImplementation(function () {
			return {
				createIndex: vi.fn().mockResolvedValue({}),
				index: () => ({
					updateSettings: vi.fn().mockRejectedValue(new Error('ENOTFOUND poetry-meilisearch')),
					getDocument: vi.fn().mockResolvedValue({ version: 5 }),
					addDocuments: vi.fn().mockResolvedValue({}),
				}),
			};
		});

		const app = Fastify({ logger: false });
		await app.register(searchPlugin);
		await app.ready();

		expect(app.meiliClient).toBeNull();

		await app.close();
	});

	it('boots with meiliClient = null when MEILI_MASTER_KEY is unset', async () => {
		// Stub to empty string — falsy, hits the !masterKey branch.
		// More robust than relying on the env var being absent in the controller's shell.
		vi.stubEnv('MEILI_MASTER_KEY', '');

		const app = Fastify({ logger: false });
		await app.register(searchPlugin);
		await app.ready();

		expect(app.meiliClient).toBeNull();
		expect(mockMeilisearchCtor).not.toHaveBeenCalled();

		await app.close();
	});

	it('boots with a real meiliClient when meilisearch is reachable', async () => {
		vi.stubEnv('MEILI_MASTER_KEY', 'test-key');
		mockMeilisearchCtor.mockImplementation(function () {
			return {
				createIndex: vi.fn().mockResolvedValue({}),
				index: () => ({
					updateSettings: vi.fn().mockResolvedValue({}),
					getDocument: vi.fn().mockResolvedValue({ version: 5 }),
					addDocuments: vi.fn().mockResolvedValue({}),
				}),
			};
		});

		const app = Fastify({ logger: false });
		await app.register(searchPlugin);
		await app.ready();

		expect(app.meiliClient).not.toBeNull();
		expect(mockMeilisearchCtor).toHaveBeenCalledWith({
			host: 'http://poetry-meilisearch:7700',
			apiKey: 'test-key',
		});

		await app.close();
	});
});
