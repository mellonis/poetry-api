import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../lib/schemas.js';
import { withConnection } from '../../lib/databaseHelpers.js';
import { reservedCheckKey, normalizeDisplayName } from '../../lib/displayName.js';
import { actorFingerprint } from '../../lib/actorFingerprint.js';
import { requireCanEditUsers } from './hooks.js';
import type { MySQLRowDataPacket, MySQLResultSetHeader } from '@fastify/mysql';

const reservedNameRow = z.object({
	id: z.number().int().positive(),
	value: z.string(),
	reason: z.string().nullable(),
	createdAt: z.string(),
	createdByUserId: z.number().int().positive().nullable(),
});

const listResponse = z.object({
	items: z.array(reservedNameRow),
	total: z.number().int().min(0),
});

const createRequest = z.object({
	value: z.string().min(1).max(64),
	reason: z.string().max(255).optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function reservedDisplayNameRoutes(fastify: FastifyInstance) {
	fastify.get('/', {
		schema: {
			description: 'List all reserved display names.',
			tags: ['CMS', 'Reserved Display Names'],
			response: { 200: listResponse, 500: errorResponse },
		},
		handler: async (request, reply) => {
			try {
				const [rows, countRows] = await withConnection(fastify.mysql, async (conn) => {
					const [r] = await conn.query<MySQLRowDataPacket[]>(
						'SELECT id, value, reason, created_at AS createdAt, created_by_user_id AS createdByUserId FROM reserved_display_name ORDER BY value',
					);
					const [c] = await conn.query<MySQLRowDataPacket[]>('SELECT COUNT(*) AS total FROM reserved_display_name');
					return [r, c];
				});
				return {
					items: (rows as MySQLRowDataPacket[]).map((r) => ({
						id: r.id as number,
						value: r.value as string,
						reason: (r.reason as string | null) ?? null,
						createdAt: new Date(r.createdAt as string).toISOString(),
						createdByUserId: (r.createdByUserId as number | null) ?? null,
					})),
					total: Number((countRows as MySQLRowDataPacket[])[0].total),
				};
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.post('/', {
		schema: {
			description: 'Add a reserved display name.',
			tags: ['CMS', 'Reserved Display Names'],
			body: createRequest,
			response: { 201: reservedNameRow, 409: errorResponse, 500: errorResponse },
		},
		preHandler: requireCanEditUsers,
		handler: async (request: FastifyRequest<{ Body: z.infer<typeof createRequest> }>, reply) => {
			try {
				const stored = normalizeDisplayName(request.body.value).toLowerCase();
				const storedCheckKey = reservedCheckKey(stored);
				const userId = request.user!.sub;

				const isDuplicate = await withConnection(fastify.mysql, async (conn) => {
					const [existing] = await conn.query<MySQLRowDataPacket[]>('SELECT value FROM reserved_display_name');
					return (existing as MySQLRowDataPacket[]).some(
						(r) => reservedCheckKey(r.value as string) === storedCheckKey,
					);
				});
				if (isDuplicate) {
					return reply.code(409).send({ error: 'already_reserved', message: 'This value is already reserved' });
				}

				const rawResult = await withConnection(fastify.mysql, async (conn) => {
					const [r] = await conn.query<MySQLResultSetHeader>(
						'INSERT INTO reserved_display_name (value, reason, created_by_user_id) VALUES (?, ?, ?)',
						[stored, request.body.reason ?? null, userId],
					);
					return r;
				});
				// Support both the real MySQL driver (ResultSetHeader object) and the test mock
				// (which wraps the response in an extra array layer).
				const insertId: number = Array.isArray(rawResult)
					? ((rawResult as unknown as Array<{ insertId: number }>)[0]?.insertId ?? 0)
					: (rawResult as MySQLResultSetHeader).insertId;

				request.log.info({ actorFingerprint: actorFingerprint(userId), reservedValue: stored }, 'Reserved display name added');
				return reply.code(201).send({
					id: insertId,
					value: stored,
					reason: request.body.reason ?? null,
					createdAt: new Date().toISOString(),
					createdByUserId: userId,
				});
			} catch (error: unknown) {
				if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
					return reply.code(409).send({ error: 'already_reserved', message: 'This value is already reserved' });
				}
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.delete('/:id', {
		schema: {
			description: 'Remove a reserved display name by id.',
			tags: ['CMS', 'Reserved Display Names'],
			params: idParam,
			response: { 204: z.void(), 404: errorResponse, 500: errorResponse },
		},
		preHandler: requireCanEditUsers,
		handler: async (request: FastifyRequest<{ Params: { id: number } }>, reply) => {
			try {
				const rawResult = await withConnection(fastify.mysql, async (conn) => {
					const [r] = await conn.query<MySQLResultSetHeader>(
						'DELETE FROM reserved_display_name WHERE id = ?',
						[request.params.id],
					);
					return r;
				});
				// Support both the real MySQL driver and the test mock (extra array wrap).
				const affectedRows: number = Array.isArray(rawResult)
					? ((rawResult as unknown as Array<{ affectedRows: number }>)[0]?.affectedRows ?? 0)
					: (rawResult as MySQLResultSetHeader).affectedRows;

				if (affectedRows === 0) return reply.code(404).send({ error: 'not_found' });
				request.log.info(
					{ actorFingerprint: actorFingerprint(request.user!.sub), reservedId: request.params.id },
					'Reserved display name removed',
				);
				return reply.code(204).send();
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});
}
