import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { createMcpHandler, McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { actorFingerprint } from '../../lib/actorFingerprint.js';
import { touchPersonalAccessToken } from '../auth/pat/databaseHelpers.js';
import { authenticateMcpCaller } from './patAuth.js';
import { callRoute, toolInputSchema, toolOutputSchema } from './bridge.js';
import { CATALOGUE, catalogueForLevel } from './catalogue.js';
import { callerToolLevel, type McpCaller } from './principal.js';

const MCP_RATE_LIMIT = { max: 120, timeWindow: '1 minute' };
const SERVER_INFO = { name: 'poetry', version: '1.0.0' };

// Tool schemas are compiled once per row: fromJsonSchema registers each object
// with the SDK's process-wide validator cache, so per-request objects would
// accumulate there forever.
const TOOL_SCHEMAS = new Map(CATALOGUE.map((row) => [row.name, { input: toolInputSchema(row), output: toolOutputSchema(row) }]));

// Per-request context handed to the SDK factory through authInfo.extra: the
// SDK passes authInfo through untouched and never reads headers itself.
interface McpRequestExtra {
	caller: McpCaller;
	requestId: string;
	log: FastifyBaseLogger;
}

const buildAuthInfo = (extra: McpRequestExtra): AuthInfo => ({
	token: '',
	clientId: extra.caller.kind === 'token' ? String(extra.caller.principal.userId) : 'anonymous',
	scopes: [callerToolLevel(extra.caller)],
	extra: extra as unknown as Record<string, unknown>,
});

// One MCP server instance per request, holding only the tools the caller's
// level unlocks; tools/list and tools/call therefore agree by construction,
// and the bridged REST route checks rights again underneath.
const buildServer = (fastify: FastifyInstance, extra: McpRequestExtra): McpServer => {
	const server = new McpServer(SERVER_INFO);
	const { caller, requestId, log } = extra;

	for (const row of catalogueForLevel(callerToolLevel(caller))) {
		const schemas = TOOL_SCHEMAS.get(row.name)!;

		server.registerTool(
			row.name,
			{
				title: row.title,
				description: row.description,
				inputSchema: schemas.input,
				outputSchema: schemas.output,
				annotations: row.annotations,
			},
			async (args) => {
				const startedAt = Date.now();

				try {
					const result = await callRoute(fastify, row, args as Record<string, unknown>, caller, requestId);

					log.info({
						...(caller.kind === 'token'
							? { actorFingerprint: actorFingerprint(caller.principal.userId), tokenId: caller.principal.tokenId }
							: { anonymous: true }),
						tool: row.name,
						isError: result.isError === true,
						durationMs: Date.now() - startedAt,
					}, 'MCP tool called');

					if (caller.kind === 'token') {
						touchPersonalAccessToken(fastify.mysql, caller.principal.tokenId)
							.catch((error) => log.warn(error, 'Could not update token last_used_at'));
					}

					return result;
				} catch (error) {
					log.error({ err: error, tool: row.name }, 'MCP tool failed');
					throw error;
				}
			},
		);
	}

	return server;
};

export async function mcpPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: mcp...');

	const handler = createMcpHandler(
		({ authInfo }) => buildServer(fastify, authInfo!.extra as unknown as McpRequestExtra),
		{
			responseMode: 'json',
			onerror: (error) => fastify.log.error({ err: error }, 'MCP handler failed'),
		},
	);
	const node = toNodeHandler(handler, {
		onerror: (error) => fastify.log.error({ err: error }, 'MCP node adapter failed'),
	});

	fastify.addHook('onClose', async () => {
		await handler.close();
	});

	fastify.all('/', {
		config: { rateLimit: MCP_RATE_LIMIT },
		schema: {
			description: 'MCP Streamable HTTP endpoint (one JSON-RPC response per POST; 2025-era clients receive it as a single SSE frame). Anonymous callers see the public tools; a personal access token unlocks editor/admin tools up to its level.',
			tags: ['MCP'],
			hide: true,
		},
	}, async (request: FastifyRequest, reply) => {
		const auth = await authenticateMcpCaller(fastify.mysql, request.headers.authorization, request.log);

		if (!auth.ok) {
			return reply.code(auth.status).send(auth.body);
		}

		const extra: McpRequestExtra = { caller: auth.caller, requestId: request.id, log: request.log };

		reply.raw.setHeader('x-request-id', request.id);
		reply.hijack();
		await node(Object.assign(request.raw, { auth: buildAuthInfo(extra) }), reply.raw, request.body);
	});

	fastify.log.info('[PLUGIN] Registered: mcp');
}
