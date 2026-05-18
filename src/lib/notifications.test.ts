import { describe, expect, it, vi } from 'vitest';
import type { MySQLPromisePool } from '@fastify/mysql';
import { upsertVoteNotification, insertReplyNotification } from './notifications.js';

interface MockConnection {
	query: ReturnType<typeof vi.fn>;
	release: ReturnType<typeof vi.fn>;
	beginTransaction: ReturnType<typeof vi.fn>;
	commit: ReturnType<typeof vi.fn>;
	rollback: ReturnType<typeof vi.fn>;
}

const buildMysql = (queryResponses: unknown[][]): { mysql: MySQLPromisePool; conn: MockConnection } => {
	let queryIndex = 0;
	const conn: MockConnection = {
		query: vi.fn().mockImplementation(() => {
			const response = queryResponses[queryIndex++] ?? [];
			return Promise.resolve([response]);
		}),
		release: vi.fn(),
		beginTransaction: vi.fn().mockResolvedValue(undefined),
		commit: vi.fn().mockResolvedValue(undefined),
		rollback: vi.fn().mockResolvedValue(undefined),
	};
	const mysql = {
		getConnection: vi.fn().mockResolvedValue(conn),
	} as unknown as MySQLPromisePool;
	return { mysql, conn };
};

describe('upsertVoteNotification', () => {
	it('increments event_count when an unread bucket already exists', async () => {
		const { mysql, conn } = buildMysql([
			[{ id: 42 }],          // findUnreadVoteBucket — hit
			{ affectedRows: 1 },    // incrementVoteBucket
		]);

		const id = await upsertVoteNotification(mysql, { recipientUserId: 7, subjectCommentId: 99 });

		expect(id).toBe(42);
		expect(conn.beginTransaction).toHaveBeenCalled();
		expect(conn.commit).toHaveBeenCalled();
		expect(conn.rollback).not.toHaveBeenCalled();
		expect(conn.release).toHaveBeenCalled();
		expect(conn.query).toHaveBeenCalledTimes(2);
	});

	it('inserts a new row when no unread bucket exists', async () => {
		const { mysql, conn } = buildMysql([
			[],                            // findUnreadVoteBucket — miss
			{ insertId: 100, affectedRows: 1 }, // insertNotification
		]);

		const id = await upsertVoteNotification(mysql, { recipientUserId: 7, subjectCommentId: 99 });

		expect(id).toBe(100);
		expect(conn.commit).toHaveBeenCalled();
		expect(conn.rollback).not.toHaveBeenCalled();
	});

	it('rolls back the transaction on SQL error', async () => {
		const { mysql, conn } = buildMysql([]);
		conn.query.mockRejectedValueOnce(new Error('boom'));

		await expect(
			upsertVoteNotification(mysql, { recipientUserId: 7, subjectCommentId: 99 }),
		).rejects.toThrow('boom');
		expect(conn.rollback).toHaveBeenCalled();
		expect(conn.commit).not.toHaveBeenCalled();
		expect(conn.release).toHaveBeenCalled();
	});
});

describe('insertReplyNotification', () => {
	it('inserts a row with the object comment id and returns the inserted id', async () => {
		const { mysql, conn } = buildMysql([
			{ insertId: 55, affectedRows: 1 },
		]);

		const id = await insertReplyNotification(mysql, {
			recipientUserId: 3,
			subjectCommentId: 10,
			objectCommentId: 20,
		});

		expect(id).toBe(55);
		expect(conn.query).toHaveBeenCalledTimes(1);
		expect(conn.release).toHaveBeenCalled();
	});
});
