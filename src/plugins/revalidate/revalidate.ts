import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

declare module 'fastify' {
	interface FastifyInstance {
		revalidateContent: (log: FastifyBaseLogger, requestId?: string) => void;
	}
}

export interface RevalidationTarget {
	name: string;
	url: string;
}

const WEBHOOK_TIMEOUT_MS = 3000;

// poetry-api is the single writer of content, so it is the one place that sees
// every change: each content-mutating CMS route calls fastify.revalidateContent,
// which POSTs the nextjs and old2 cache-clear webhooks. Fire-and-forget — a
// failed or slow webhook never fails the save. The umbrella CLAUDE.md
// (cache revalidation) describes the contract.
export const callRevalidationWebhooks = async (
	targets: RevalidationTarget[],
	secret: string,
	log: FastifyBaseLogger,
	requestId: string | undefined,
	fetchImpl: typeof fetch = fetch,
	timeoutMs: number = WEBHOOK_TIMEOUT_MS,
): Promise<void> => {
	await Promise.all(targets.map(async (target) => {
		const headers: Record<string, string> = { 'X-Revalidation-Secret': secret };

		if (requestId) {
			headers['X-Request-Id'] = requestId;
		}

		try {
			const response = await fetchImpl(target.url, { method: 'POST', headers, signal: AbortSignal.timeout(timeoutMs) });

			if (!response.ok) {
				log.warn({ target: target.name, status: response.status }, 'Revalidation webhook failed');
			}
		} catch (error) {
			log.warn({ target: target.name, reason: error instanceof Error ? error.message : String(error) }, 'Revalidation webhook failed');
		}
	}));
};

const resolveTargets = (): RevalidationTarget[] => {
	const targets: RevalidationTarget[] = [];

	if (process.env.NEXTJS_REVALIDATE_URL) targets.push({ name: 'nextjs', url: process.env.NEXTJS_REVALIDATE_URL });
	if (process.env.WWW_REVALIDATE_URL) targets.push({ name: 'old2', url: process.env.WWW_REVALIDATE_URL });

	return targets;
};

export const revalidatePlugin = fastifyPlugin(async (fastify: FastifyInstance) => {
	fastify.log.info('[PLUGIN] Registering: revalidate...');

	const targets = resolveTargets();
	const secret = process.env.REVALIDATION_SECRET;

	if (targets.length > 0 && !secret) {
		throw new Error('REVALIDATION_SECRET must be set when NEXTJS_REVALIDATE_URL or WWW_REVALIDATE_URL is set');
	}

	if (targets.length === 0) {
		fastify.log.warn('[PLUGIN] revalidate: no webhook URLs configured — content writes will not clear site caches');
	}

	fastify.decorate('revalidateContent', (log: FastifyBaseLogger, requestId?: string) => {
		if (targets.length === 0 || !secret) {
			return;
		}

		void callRevalidationWebhooks(targets, secret, log, requestId)
			.catch((error) => log.error(error, 'Revalidation failed'));
	});

	fastify.log.info({ targets: targets.map((t) => t.name) }, '[PLUGIN] Registered: revalidate');
});
