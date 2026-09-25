import { describe, expect, it, vi } from 'vitest';
import type { MySQLPromisePool } from '@fastify/mysql';
import { authenticateMcpCaller } from './patAuth.js';
import { callerToolLevel } from './principal.js';
import { generatePersonalAccessToken } from '../auth/pat/token.js';

const mysqlWith = (rows: Record<string, unknown>[]) => ({
	getConnection: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue([rows]), release: vi.fn() }),
}) as unknown as MySQLPromisePool;

const log = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) as unknown as import('fastify').FastifyBaseLogger;

const tokenRow = (scope: number, account: Partial<Record<string, unknown>> = {}) => ({
	token_id: 5, scope, user_id: 3, user_login: 'ed', user_rights: 25, group_id: 2, group_rights: 14336, token_version: 0, ...account,
});

describe('authenticateMcpCaller', () => {
	it('no header → anonymous', async () => {
		const r = await authenticateMcpCaller(mysqlWith([]), undefined, log());
		expect(r).toEqual({ ok: true, caller: { kind: 'anonymous' } });
		expect(callerToolLevel({ kind: 'anonymous' })).toBe('public');
	});

	it('rejects a JWT bearer with the PAT-only message', async () => {
		const l = log();
		const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';
		const r = await authenticateMcpCaller(mysqlWith([]), `Bearer ${jwt}`, l);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.body.message).toMatch(/personal access tokens only/);
		expect(l.warn).toHaveBeenCalledWith('MCP auth failed: non-PAT bearer');
		expect(JSON.stringify((l.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(jwt);
	});

	it('rejects a malformed Authorization header and warns without its value', async () => {
		const l = log();
		const r = await authenticateMcpCaller(mysqlWith([]), 'Basic c2VjcmV0', l);
		expect(r.ok).toBe(false);
		expect(l.warn).toHaveBeenCalledWith('MCP auth failed: malformed Authorization header');
		expect(JSON.stringify((l.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('c2VjcmV0');
	});

	it('rejects an unknown token and warns without the token value', async () => {
		const l = log();
		const token = generatePersonalAccessToken();
		const r = await authenticateMcpCaller(mysqlWith([]), `Bearer ${token}`, l);
		expect(r.ok).toBe(false);
		expect(l.warn).toHaveBeenCalled();
		expect(JSON.stringify((l.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(token);
	});

	it('rejects a banned account', async () => {
		const r = await authenticateMcpCaller(mysqlWith([tokenRow(2, { user_rights: 25 | 4 })]), `Bearer ${generatePersonalAccessToken()}`, log());
		expect(r.ok).toBe(false);
	});

	it('builds a principal capped to the lower of scope and account level', async () => {
		const editorScopeOnEditor = await authenticateMcpCaller(mysqlWith([tokenRow(2)]), `Bearer ${generatePersonalAccessToken()}`, log());
		expect(editorScopeOnEditor.ok && editorScopeOnEditor.caller.kind === 'token' && editorScopeOnEditor.caller.principal.level).toBe('editor');

		const adminScopeOnEditor = await authenticateMcpCaller(mysqlWith([tokenRow(3)]), `Bearer ${generatePersonalAccessToken()}`, log());
		expect(adminScopeOnEditor.ok && adminScopeOnEditor.caller.kind === 'token' && adminScopeOnEditor.caller.principal.level).toBe('editor');

		const readScopeOnAdmin = await authenticateMcpCaller(mysqlWith([tokenRow(1, { group_id: 1, group_rights: 63488 })]), `Bearer ${generatePersonalAccessToken()}`, log());
		expect(readScopeOnAdmin.ok && readScopeOnAdmin.caller.kind === 'token' && readScopeOnAdmin.caller.principal.level).toBe('read');
		expect(readScopeOnAdmin.ok && callerToolLevel(readScopeOnAdmin.caller)).toBe('public');
	});
});
