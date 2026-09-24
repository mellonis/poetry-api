import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { buildToolInput, buildUrl, callRoute, cappedClaims, formatRouteError, shapeOutput, splitArgs, toolInputSchema, toolOutputSchema, type CatalogueRow } from './bridge.js';
import { verifyAccessToken } from '../auth/jwt.js';
import type { McpPrincipal } from './principal.js';

const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
const secret = new TextEncoder().encode(JWT_SECRET);

const principal = (level: McpPrincipal['level']): McpPrincipal => ({
	userId: 3, login: 'ed', tokenId: 5, tokenVersion: 2, level, isAdmin: true, isEditor: true,
	rights: { canVote: true, canComment: true, canEditContent: true, canEditUsers: true },
});

const row: CatalogueRow = {
	name: 'cms_update_thing', level: 'editor', method: 'PUT', path: '/cms/things/:thingId',
	title: 'Update thing', description: 'Update a thing.', annotations: { idempotentHint: true },
	params: z.object({ thingId: z.number().int().positive() }),
	body: z.object({ title: z.string().nullable().optional().transform((v) => v ?? null), text: z.string().optional() }),
	output: z.object({ id: z.number(), title: z.string().nullable() }),
};

describe('cappedClaims', () => {
	it('read → no roles, no rights', () => {
		expect(cappedClaims(principal('read'))).toEqual({
			sub: 3, login: 'ed', tokenVersion: 2, isAdmin: false, isEditor: false,
			rights: { canVote: false, canComment: false, canEditContent: false, canEditUsers: false },
		});
	});

	it('editor → editor role and canEditContent only', () => {
		const c = cappedClaims(principal('editor'));
		expect(c.isAdmin).toBe(false);
		expect(c.isEditor).toBe(true);
		expect(c.rights).toEqual({ canVote: false, canComment: false, canEditContent: true, canEditUsers: false });
	});

	it('admin → exactly the account claims', () => {
		const c = cappedClaims(principal('admin'));
		expect(c.isAdmin).toBe(true);
		expect(c.rights.canEditUsers).toBe(true);
	});
});

describe('argument plumbing', () => {
	it('merges params, query and body fields into one input object', () => {
		const shape = buildToolInput({ ...row, query: z.object({ limit: z.number().optional() }) }).shape;
		expect(Object.keys(shape).sort()).toEqual(['limit', 'text', 'thingId', 'title']);
	});

	it('wraps a non-object body under bodyKey', () => {
		const r: CatalogueRow = { ...row, body: z.array(z.number()), bodyKey: 'ids' };
		expect(Object.keys(buildToolInput(r).shape)).toEqual(['thingId', 'ids']);
		expect(splitArgs(r, { thingId: 1, ids: [3, 2] })).toEqual({ params: { thingId: 1 }, query: {}, body: [3, 2] });
	});

	it('splits and encodes', () => {
		expect(splitArgs(row, { thingId: 7, title: 'x' })).toEqual({ params: { thingId: 7 }, query: {}, body: { title: 'x' } });
		expect(buildUrl('/sections/:identifier', { identifier: 'a b' }, { q: 'x y', limit: 5 })).toBe('/sections/a%20b?q=x+y&limit=5');
	});

	it('produces JSON-schema-backed tool schemas that skip transforms and tolerate dates', () => {
		expect(() => toolInputSchema(row)).not.toThrow();
		expect(() => toolOutputSchema({ ...row, output: z.object({ lastModified: z.date().optional() }) })).not.toThrow();
		expect(() => toolOutputSchema({ ...row, output: z.array(z.string()) })).not.toThrow();
		expect(() => toolOutputSchema({ ...row, output: 'none' })).not.toThrow();
	});
});

describe('response shaping', () => {
	it('wraps arrays as items, none as ok, applies mapOutput', () => {
		expect(shapeOutput({ ...row, output: z.array(z.number()) }, [1, 2])).toEqual({ items: [1, 2] });
		expect(shapeOutput({ ...row, output: 'none' }, undefined)).toEqual({ ok: true });
		expect(shapeOutput({ ...row, mapOutput: (v) => ({ ...(v as object), extra: 1 }) }, { id: 1 })).toEqual({ id: 1, extra: 1 });
	});

	it('formats validation issues so the model can fix its arguments', () => {
		const text = formatRouteError(400, { error: 'validation', issues: [{ path: ['text'], message: 'Too small' }] });
		expect(text).toMatch(/400/);
		expect(text).toMatch(/text/);
		expect(text).toMatch(/Too small/);
		expect(formatRouteError(403, { error: 'forbidden', message: 'Cannot delete root admin' })).toBe('403 forbidden: Cannot delete root admin');
	});
});

describe('callRoute', () => {
	async function appWithRoute() {
		vi.stubEnv('JWT_SECRET', JWT_SECRET);
		vi.stubEnv('JWT_ACCESS_TOKEN_TTL', '900');
		const app = Fastify({ logger: false });
		app.setValidatorCompiler(validatorCompiler);
		app.setSerializerCompiler(serializerCompiler);
		const seen: { auth?: string; reqId?: string; body?: unknown } = {};
		app.put('/cms/things/:thingId', async (request, reply) => {
			seen.auth = request.headers.authorization;
			seen.reqId = request.headers['x-request-id'] as string;
			seen.body = request.body;
			const { thingId } = request.params as { thingId: string };
			if (thingId === '404') return reply.code(404).send({ error: 'not_found', message: 'Thing not found' });
			if (thingId === '500') return reply.code(500).send({ error: 'boom' });
			return { id: Number(thingId), title: (request.body as { title?: string }).title ?? null };
		});
		await app.ready();
		return { app, seen };
	}

	it('injects the route with a capped JWT and the request id, returns structuredContent', async () => {
		const { app, seen } = await appWithRoute();
		const result = await callRoute(app, row, { thingId: 7, title: 'Утро' }, { kind: 'token', principal: principal('editor') }, 'req-9');
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toEqual({ id: 7, title: 'Утро' });
		expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ id: 7, title: 'Утро' }) }]);
		expect(seen.reqId).toBe('req-9');
		expect(seen.body).toEqual({ title: 'Утро' });
		const claims = await verifyAccessToken(seen.auth!.substring(7), secret);
		expect(claims).toMatchObject({ sub: 3, isAdmin: false, isEditor: true });
	});

	it('sends no Authorization for an anonymous caller', async () => {
		const { app, seen } = await appWithRoute();
		await callRoute(app, row, { thingId: 7 }, { kind: 'anonymous' }, 'req-9');
		expect(seen.auth).toBeUndefined();
	});

	it('maps 4xx to isError and 5xx to a thrown error', async () => {
		const { app } = await appWithRoute();
		const notFound = await callRoute(app, row, { thingId: 404 }, { kind: 'anonymous' }, 'r');
		expect(notFound.isError).toBe(true);
		expect(notFound.content[0]).toEqual({ type: 'text', text: '404 not_found: Thing not found' });
		await expect(callRoute(app, row, { thingId: 500 }, { kind: 'anonymous' }, 'r')).rejects.toThrow(/500/);
	});
});
