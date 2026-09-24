import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { callRevalidationWebhooks, revalidatePlugin, type RevalidationTarget } from './revalidate.js';

const targets: RevalidationTarget[] = [
	{ name: 'nextjs', url: 'http://poetry:3000/api/revalidate' },
	{ name: 'old2', url: 'http://poetry-old2/revalidate.php' },
];

const logger = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) as unknown as import('fastify').FastifyBaseLogger;

describe('callRevalidationWebhooks', () => {
	it('POSTs both targets with the secret and request id', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		const log = logger();
		await callRevalidationWebhooks(targets, 's3cret', log, 'req-1', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		for (const [url, init] of fetchImpl.mock.calls as [string, RequestInit][]) {
			expect(targets.map((t) => t.url)).toContain(url);
			expect(init.method).toBe('POST');
			expect((init.headers as Record<string, string>)['X-Revalidation-Secret']).toBe('s3cret');
			expect((init.headers as Record<string, string>)['X-Request-Id']).toBe('req-1');
			expect(init.signal).toBeInstanceOf(AbortSignal);
		}
		expect(log.warn).not.toHaveBeenCalled();
	});

	it('warns on a non-2xx answer and still calls the other target', async () => {
		const fetchImpl = vi.fn()
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(new Response(null, { status: 200 }));
		const log = logger();
		await callRevalidationWebhooks(targets, 's3cret', log, 'req-1', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(log.warn).toHaveBeenCalledWith({ target: 'nextjs', status: 401 }, 'Revalidation webhook failed');
	});

	it('times out without failing and never logs the secret', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
			new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
		const log = logger();
		await expect(callRevalidationWebhooks(targets, 's3cret', log, 'req-1', fetchImpl, 20)).resolves.toBeUndefined();
		expect(log.warn).toHaveBeenCalledTimes(2);
		expect(JSON.stringify((log.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('s3cret');
	});
});

describe('revalidatePlugin', () => {
	it('refuses to boot with a URL but no secret', async () => {
		vi.stubEnv('NEXTJS_REVALIDATE_URL', 'http://poetry:3000/api/revalidate');
		vi.stubEnv('WWW_REVALIDATE_URL', '');
		vi.stubEnv('REVALIDATION_SECRET', '');
		const app = Fastify({ logger: false });
		await expect(app.register(revalidatePlugin).ready()).rejects.toThrow(/REVALIDATION_SECRET/);
		vi.unstubAllEnvs();
	});

	it('is a no-op when nothing is configured', async () => {
		vi.stubEnv('NEXTJS_REVALIDATE_URL', '');
		vi.stubEnv('WWW_REVALIDATE_URL', '');
		vi.stubEnv('REVALIDATION_SECRET', '');
		const app = Fastify({ logger: false });
		await app.register(revalidatePlugin).ready();
		expect(() => app.revalidateContent(logger(), 'req-1')).not.toThrow();
		vi.unstubAllEnvs();
	});
});
