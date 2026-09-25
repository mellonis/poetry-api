import { describe, expect, it, vi } from 'vitest';
import type { MySQLPromisePool } from '@fastify/mysql';
import {
	createPersonalAccessToken,
	deletePersonalAccessToken,
	findPersonalAccessTokenWithUser,
	listPersonalAccessTokens,
} from './databaseHelpers.js';

function createRecordingMysql(...responses: unknown[]) {
	let callIndex = 0;
	const calls: { sql: string; params: unknown[] }[] = [];
	const pool = {
		getConnection: vi.fn().mockImplementation(() =>
			Promise.resolve({
				query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
					calls.push({ sql, params: params ?? [] });
					return Promise.resolve([responses[callIndex++] ?? []]);
				}),
				release: vi.fn(),
			}),
		),
	} as unknown as MySQLPromisePool;
	return { pool, calls };
}

describe('personal access token helpers', () => {
	it('createPersonalAccessToken inserts user, name, hash, scope and returns the id', async () => {
		const { pool, calls } = createRecordingMysql({ insertId: 7 });
		const id = await createPersonalAccessToken(pool, 3, 'laptop', 'a'.repeat(64), 2);
		expect(id).toBe(7);
		expect(calls[0].sql).toMatch(/INSERT INTO auth_personal_access_token/);
		expect(calls[0].params).toEqual([3, 'laptop', 'a'.repeat(64), 2]);
	});

	it('listPersonalAccessTokens maps rows and never exposes the hash', async () => {
		const { pool } = createRecordingMysql([
			{ id: 1, name: 'laptop', scope: 2, created_at: new Date('2026-09-25T10:00:00Z'), last_used_at: null },
		]);
		const rows = await listPersonalAccessTokens(pool, 3);
		expect(rows).toEqual([{ id: 1, name: 'laptop', scope: 'editor', createdAt: new Date('2026-09-25T10:00:00Z'), lastUsedAt: null }]);
		expect(JSON.stringify(rows)).not.toMatch(/hash/);
	});

	it('findPersonalAccessTokenWithUser joins the account and maps the scope', async () => {
		const { pool, calls } = createRecordingMysql([
			{ token_id: 5, scope: 3, user_id: 1, user_login: 'admin', user_rights: 25, group_id: 1, group_rights: 63488, token_version: 0 },
		]);
		const row = await findPersonalAccessTokenWithUser(pool, 'b'.repeat(64));
		expect(row).toEqual({ tokenId: 5, scope: 'admin', userId: 1, login: 'admin', userRights: 25, groupId: 1, groupRights: 63488, tokenVersion: 0 });
		expect(calls[0].params).toEqual(['b'.repeat(64)]);
	});

	it('findPersonalAccessTokenWithUser returns null for an unknown hash', async () => {
		const { pool } = createRecordingMysql([]);
		expect(await findPersonalAccessTokenWithUser(pool, 'c'.repeat(64))).toBeNull();
	});

	it('deletePersonalAccessToken scopes the delete to the owner', async () => {
		const { pool, calls } = createRecordingMysql({ affectedRows: 0 });
		expect(await deletePersonalAccessToken(pool, 5, 9)).toBe(false);
		expect(calls[0].sql).toMatch(/WHERE id = \? AND r_user_id = \?/);
		expect(calls[0].params).toEqual([5, 9]);
	});
});
